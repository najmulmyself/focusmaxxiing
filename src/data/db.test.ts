import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, saveSession, sessionsBetween } from './db'
import type { SessionRecord } from '../timer/engine'

const rec = (id: string, startedAt: number): SessionRecord => ({
  id, mode: 'focus', status: 'completed', plannedSec: 1500, actualSec: 1500, startedAt, endedAt: startedAt + 1_500_000,
  pauses: 0, taskId: null, note: '', quality: null, device: 'test', createdAt: startedAt, revision: 1,
})

describe('session store', () => {
  beforeEach(async () => {
    await db.sessions.clear()
  })

  it('is idempotent by id', async () => {
    await saveSession(rec('a', 1000))
    await saveSession(rec('a', 1000))
    expect(await db.sessions.count()).toBe(1)
  })

  it('queries by start time', async () => {
    await saveSession(rec('a', 1000))
    await saveSession(rec('b', 5000))
    await saveSession(rec('c', 9000))
    const got = await sessionsBetween(2000, 9000)
    expect(got.map((s) => s.id)).toEqual(['b'])
  })
})
