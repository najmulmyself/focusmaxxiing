import Dexie, { type Table } from 'dexie'
import type { SessionRecord } from '../timer/engine'
import { KEYS, readJSON, writeJSON } from './local'

class FocusDB extends Dexie {
  sessions!: Table<SessionRecord, string>
  constructor() {
    super('focusmaxxiing')
    this.version(1).stores({
      sessions: 'id, startedAt, endedAt, mode, status, taskId',
    })
  }
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
  return db.sessions.where('startedAt').between(from, to, true, false).sortBy('startedAt')
}
