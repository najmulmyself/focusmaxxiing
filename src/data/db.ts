import Dexie, { type Table } from 'dexie'
import type { SessionRecord } from '../timer/engine'
import type { Project, Task, Template } from './model'
import { KEYS, readJSON, writeJSON } from './local'

class FocusDB extends Dexie {
  sessions!: Table<SessionRecord, string>
  tasks!: Table<Task, string>
  projects!: Table<Project, string>
  templates!: Table<Template, string>
  /** last version of each record known to be on the server: `${kind}:${id}` → version */
  syncState!: Table<{ key: string; version: number }, string>
  constructor() {
    super('focusmaxxiing')
    this.version(1).stores({
      sessions: 'id, startedAt, endedAt, mode, status, taskId',
    })
    this.version(2)
      .stores({
        sessions: 'id, startedAt, endedAt, mode, status, taskId, projectId',
        tasks: 'id, order, projectId',
        projects: 'id, order',
        templates: 'id',
      })
      .upgrade((tx) =>
        tx
          .table('sessions')
          .toCollection()
          .modify((s: SessionRecord) => {
            s.projectId ??= null
          }),
      )
    this.version(3).stores({ syncState: 'key' })
    // tell the sync engine whenever a synced table changes (any write path)
    this.use({
      stack: 'dbcore',
      name: 'sync-notify',
      create: (down) => ({
        ...down,
        table: (name) => {
          const t = down.table(name)
          if (name === 'syncState') return t
          return {
            ...t,
            mutate: (req) =>
              t.mutate(req).then((res) => {
                for (const fn of changeListeners) fn(name)
                return res
              }),
          }
        },
      }),
    })
  }
}

const changeListeners = new Set<(table: string) => void>()
export const onLocalChange = (fn: (table: string) => void) => {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

export const db = new FocusDB()

let persistAsked = false
/** Ask the browser not to evict our data under storage pressure. */
async function askPersist() {
  if (persistAsked) return
  persistAsked = true
  try {
    await navigator.storage?.persist?.()
  } catch {
    /* not supported */
  }
}

/**
 * Save a session. Ids are stable, so saving twice is harmless (put = upsert).
 * If IndexedDB fails, the record is parked in localStorage and retried on the next save/startup.
 */
export async function saveSession(rec: SessionRecord): Promise<void> {
  void askPersist()
  try {
    await db.sessions.put(rec)
  } catch {
    const pending = readJSON<SessionRecord[]>(KEYS.pending) ?? []
    if (!pending.some((p) => p.id === rec.id)) pending.push(rec)
    writeJSON(KEYS.pending, pending)
    return
  }
  await flushPending()
}

export async function flushPending(): Promise<number> {
  const pending = readJSON<SessionRecord[]>(KEYS.pending)
  if (!pending?.length) return 0
  try {
    await db.sessions.bulkPut(pending)
    writeJSON(KEYS.pending, [])
    return pending.length
  } catch {
    return 0
  }
}

export function sessionsBetween(from: number, to: number) {
  return db.sessions
    .where('startedAt')
    .between(from, to, true, false)
    .filter((s) => !s.deletedAt)
    .sortBy('startedAt')
}

export const allSessions = () => db.sessions.filter((s) => !s.deletedAt).sortBy('startedAt')

export type SessionPatch = Partial<Pick<SessionRecord, 'note' | 'quality' | 'taskId' | 'projectId' | 'mode' | 'status' | 'startedAt' | 'endedAt' | 'actualSec' | 'deletedAt'>>

/** Edit a logged session. Bumps the revision so sync can tell versions apart. */
export async function updateSession(id: string, patch: SessionPatch) {
  const now = Date.now()
  await db.sessions.where('id').equals(id).modify((s) => {
    Object.assign(s, patch)
    s.revision = (s.revision ?? 1) + 1
    // strictly increasing, even for two edits in the same millisecond
    s.updatedAt = Math.max(now, (s.updatedAt ?? s.createdAt) + 1)
  })
}

export const deleteSession = (id: string) => updateSession(id, { deletedAt: Date.now() })
export const restoreSession = (id: string) => updateSession(id, { deletedAt: null })
