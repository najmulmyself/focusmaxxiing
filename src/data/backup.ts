import { db } from './db'
import { KEYS, deviceId, readJSON, writeJSON } from './local'
import { buildBackup, mergeById, parseBackup, sessionVersion, updatedVersion, type Backup, type Dataset } from './formats'
import { sanitize, type Settings } from '../timer/settings'

export async function readDataset(): Promise<Dataset> {
  const [sessions, tasks, projects, templates] = await Promise.all([db.sessions.toArray(), db.tasks.toArray(), db.projects.toArray(), db.templates.toArray()])
  return { sessions, tasks, projects, templates }
}

export async function createBackup(): Promise<Backup> {
  return buildBackup(await readDataset(), readJSON<Settings>(KEYS.settings), deviceId())
}

export interface ImportSummary {
  sessions: { added: number; updated: number; unchanged: number }
  tasks: { added: number; updated: number; unchanged: number }
  projects: { added: number; updated: number; unchanged: number }
  templates: { added: number; updated: number; unchanged: number }
  settings: boolean
}

/**
 * Restore a backup.
 * - merge (default): add what's missing, take newer versions of what exists, never delete.
 * - replace: make the local data an exact copy of the backup.
 * Runs in one transaction: it all lands, or nothing does.
 */
export async function importBackup(text: string, opts: { mode: 'merge' | 'replace'; settings: boolean }): Promise<ImportSummary> {
  const backup = parseBackup(text)
  const incoming = backup.data
  const local = opts.mode === 'replace' ? { sessions: [], tasks: [], projects: [], templates: [] } : await readDataset()
  const s = mergeById(local.sessions, incoming.sessions, sessionVersion)
  const t = mergeById(local.tasks, incoming.tasks, updatedVersion)
  const p = mergeById(local.projects, incoming.projects, updatedVersion)
  const tp = mergeById(local.templates, incoming.templates, updatedVersion)

  await db.transaction('rw', db.sessions, db.tasks, db.projects, db.templates, async () => {
    if (opts.mode === 'replace') await Promise.all([db.sessions.clear(), db.tasks.clear(), db.projects.clear(), db.templates.clear()])
    await db.sessions.bulkPut(s.put)
    await db.tasks.bulkPut(t.put)
    await db.projects.bulkPut(p.put)
    await db.templates.bulkPut(tp.put)
  })

  let settings = false
  if (opts.settings && backup.settings) {
    settings = writeJSON(KEYS.settings, sanitize(backup.settings))
  }
  const strip = ({ added, updated, unchanged }: { added: number; updated: number; unchanged: number }) => ({ added, updated, unchanged })
  return { sessions: strip(s), tasks: strip(t), projects: strip(p), templates: strip(tp), settings }
}

const LAST_BACKUP = 'fm.lastBackup.v1'
export const lastBackupAt = () => readJSON<number>(LAST_BACKUP)
export const markBackedUp = () => writeJSON(LAST_BACKUP, Date.now())

/** Save text as a file through the browser's download flow. */
export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const fileStamp = (ms = Date.now()) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
