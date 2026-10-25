import { db, onLocalChange } from '../data/db'
import { KEYS, readJSON, writeJSON } from '../data/local'
import type { Project, Task, Template } from '../data/model'
import type { SessionRecord } from '../timer/engine'
import { SETTINGS_SAVED, SETTINGS_SYNCED } from '../timer/useSettings'

/*
 * Local-first sync. IndexedDB stays the source of truth for the UI; this engine
 * pushes records whose version moved past what the server last saw, then pulls
 * everything the server has changed since our cursor. Newest version wins on
 * both sides. Sample data never leaves the device.
 */

export type Kind = 'session' | 'task' | 'project' | 'template' | 'settings'
interface Wire {
  kind: Kind
  id: string
  version: number
  data: unknown
}

export type Phase = 'loading' | 'unavailable' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncStatus {
  phase: Phase
  email: string | null
  lastSyncAt: number | null
  /** local changes not yet on the server */
  pending: number
  error: string | null
  googleClientId: string | null
  devAuth: boolean
}

interface Saved {
  token: string
  email: string
  cursor: number
  lastSyncAt: number | null
}

const TABLES = { session: () => db.sessions, task: () => db.tasks, project: () => db.projects, template: () => db.templates } as const
type TableKind = keyof typeof TABLES

const versionOf: Record<TableKind, (r: never) => number> = {
  session: (s: SessionRecord) => s.updatedAt ?? s.createdAt,
  task: (t: Task) => t.updatedAt,
  project: (p: Project) => p.updatedAt,
  template: (t: Template) => t.updatedAt,
}
const isSample = (id: string) => id.startsWith('sample-')

let status: SyncStatus = { phase: 'loading', email: null, lastSyncAt: null, pending: 0, error: null, googleClientId: null, devAuth: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch }
  listeners.forEach((fn) => fn())
}
export const getStatus = () => status
export const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const saved = () => readJSON<Saved>(KEYS.sync)
const save = (s: Saved | null) => (s ? writeJSON(KEYS.sync, s) : localStorage.removeItem(KEYS.sync))

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new HttpError(body.error ?? `Sync failed (${res.status})`, res.status)
  return body
}

/* ------------------------------------------------------------------ */

/** Everything local whose version differs from what the server last confirmed. */
async function collectChanges(): Promise<Wire[]> {
  const state = new Map((await db.syncState.toArray()).map((r) => [r.key, r.version]))
  const out: Wire[] = []
  for (const kind of Object.keys(TABLES) as TableKind[]) {
    const rows = (await TABLES[kind]().toArray()) as { id: string }[]
    for (const r of rows) {
      if (isSample(r.id)) continue
      const version = versionOf[kind](r as never)
      if (state.get(`${kind}:${r.id}`) !== version) out.push({ kind, id: r.id, version, data: r })
    }
  }
  const settingsAt = readJSON<number>(KEYS.settingsAt)
  const settings = readJSON(KEYS.settings)
  if (settingsAt && settings && state.get('settings:settings') !== settingsAt) out.push({ kind: 'settings', id: 'settings', version: settingsAt, data: settings })
  return out
}

async function markSynced(records: Wire[]) {
  await db.syncState.bulkPut(records.map((r) => ({ key: `${r.kind}:${r.id}`, version: r.version })))
}

/** Adopt remote records that are newer than ours, in one transaction with their sync state. */
async function apply(records: Wire[]) {
  let settingsChanged = false
  await db.transaction('rw', [db.sessions, db.tasks, db.projects, db.templates, db.syncState], async () => {
    for (const r of records) {
      if (r.kind === 'settings') {
        const localAt = readJSON<number>(KEYS.settingsAt) ?? 0
        if (r.version > localAt) {
          writeJSON(KEYS.settings, r.data)
          writeJSON(KEYS.settingsAt, r.version)
          settingsChanged = true
        }
        await db.syncState.put({ key: 'settings:settings', version: Math.max(r.version, localAt) })
        continue
      }
      const table = TABLES[r.kind]()
      const local = (await table.get(r.id)) as never
      const localVersion = local ? versionOf[r.kind](local) : -1
      if (r.version > localVersion) {
        await table.put(r.data as never)
        await db.syncState.put({ key: `${r.kind}:${r.id}`, version: r.version })
      } else if (r.version === localVersion) {
        await db.syncState.put({ key: `${r.kind}:${r.id}`, version: r.version })
      }
      // local is newer: leave it dirty so it gets pushed
    }
  })
  if (settingsChanged) window.dispatchEvent(new Event(SETTINGS_SYNCED))
}

let running: Promise<void> | null = null
let again = false

/** Push local changes, then pull remote ones. Safe to call any time; calls coalesce. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await syncOnce()
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

async function syncOnce() {
  const s = saved()
  if (!s || status.phase === 'unavailable') return
  if (!navigator.onLine) {
    set({ phase: 'offline', pending: (await collectChanges()).length })
    return
  }
  set({ phase: 'syncing', error: null })
  try {
    const changes = await collectChanges()
    for (let i = 0; i < changes.length; i += 400) {
      const chunk = changes.slice(i, i + 400)
      await api('/sync/push', { method: 'POST', body: JSON.stringify({ records: chunk }) }, s.token)
      await markSynced(chunk)
      set({ pending: changes.length - i - chunk.length })
    }
    let cursor = s.cursor
    for (;;) {
      const page = await api<{ records: Wire[]; next: number; more: boolean }>(`/sync/pull?since=${cursor}`, {}, s.token)
      await apply(page.records)
      cursor = page.next
      save({ ...s, cursor, lastSyncAt: Date.now() })
      if (!page.more) break
    }
    const lastSyncAt = Date.now()
    save({ ...s, cursor, lastSyncAt })
    set({ phase: 'idle', lastSyncAt, pending: (await collectChanges()).length })
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      save(null)
      set({ phase: 'signed-out', email: null, error: e.message })
      return
    }
    const offline = !navigator.onLine || e instanceof TypeError
    set({ phase: offline ? 'offline' : 'error', error: offline ? null : (e as Error).message, pending: (await collectChanges()).length })
  }
}

/* ------------------------------------------------------------------ */

let timer: ReturnType<typeof setTimeout> | null = null
/** Debounced sync after local edits. */
export function requestSync(delay = 1500) {
  if (!saved()) {
    void collectChanges().then((c) => set({ pending: c.length }))
    return
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

async function startSession(token: string, email: string) {
  const prev = saved()
  // a different account must not inherit the previous account's sync state
  if (prev?.email !== email) await db.syncState.clear()
  save({ token, email, cursor: prev?.email === email ? prev.cursor : 0, lastSyncAt: null })
  set({ phase: 'idle', email, error: null })
  await syncNow()
}

export async function signInWithGoogle(credential: string) {
  const r = await api<{ token: string; email: string }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) })
  await startSession(r.token, r.email)
}

export async function signInDev(email: string) {
  const r = await api<{ token: string; email: string }>('/auth/dev', { method: 'POST', body: JSON.stringify({ email }) })
  await startSession(r.token, r.email)
}

/** Sign out this device. Local data stays; syncing stops until you sign in again. */
export async function signOut() {
  const s = saved()
  if (s) await api('/auth/logout', { method: 'POST' }, s.token).catch(() => {})
  save(null)
  set({ phase: 'signed-out', email: null, lastSyncAt: null })
}

let started = false
export async function initSync() {
  if (started) return
  started = true
  let cfg: { sync: boolean; googleClientId: string | null; devAuth: boolean }
  try {
    cfg = await api('/config')
  } catch {
    // no server (static hosting or `vite dev`): local-only, as before
    set({ phase: 'unavailable' })
    return
  }
  const s = saved()
  set({ googleClientId: cfg.googleClientId, devAuth: cfg.devAuth, phase: !cfg.sync ? 'unavailable' : s ? 'idle' : 'signed-out', email: s?.email ?? null, lastSyncAt: s?.lastSyncAt ?? null })
  if (!cfg.sync) return

  onLocalChange(() => requestSync())
  window.addEventListener(SETTINGS_SAVED, () => requestSync())
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('focus', () => void syncNow())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow())
  setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000)
  if (s) await syncNow()
  else set({ pending: (await collectChanges()).length })
}
