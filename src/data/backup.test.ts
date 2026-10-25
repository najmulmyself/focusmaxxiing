import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, saveSession, updateSession, deleteSession } from './db'
import { createBackup, importBackup, readDataset } from './backup'
import { addProject, addTask, saveTemplate, setDone, activeTasks } from './tasks'
import type { SessionRecord } from '../timer/engine'

const session = (id: string, taskId: string | null, projectId: string | null, startedAt: number): SessionRecord => ({
  id, mode: 'focus', status: 'completed', plannedSec: 1500, actualSec: 1500, startedAt, endedAt: startedAt + 1_500_000, pauses: 0,
  taskId, projectId, note: '', quality: null, device: 'test', createdAt: startedAt, revision: 1, deletedAt: null,
})

const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))
const snapshot = async () => {
  const d = await readDataset()
  return { sessions: sortById(d.sessions), tasks: sortById(d.tasks), projects: sortById(d.projects), templates: sortById(d.templates) }
}

async function seed() {
  const p = await addProject('Writing')
  const t = await addTask({ title: 'Essay', est: 3, projectId: p.id, notes: 'Second draft' })
  await addTask({ title: 'Inbox' })
  await saveTemplate('Day', activeTasks(await db.tasks.toArray()))
  await saveSession(session('a', t.id, p.id, 1_000_000))
  await saveSession(session('b', t.id, p.id, 3_000_000))
  await saveSession(session('c', null, null, 5_000_000))
  await updateSession('a', { note: 'Outlined', quality: 4 })
  await deleteSession('c')
  await setDone(t.id, true)
}

describe('backup round trip', () => {
  beforeEach(async () => {
    await Promise.all([db.sessions.clear(), db.tasks.clear(), db.projects.clear(), db.templates.clear()])
  })

  it('export → wipe → import gives an identical database', async () => {
    await seed()
    const before = await snapshot()
    const file = JSON.stringify(await createBackup())
    await Promise.all([db.sessions.clear(), db.tasks.clear(), db.projects.clear(), db.templates.clear()])
    expect((await snapshot()).sessions).toHaveLength(0)
    const summary = await importBackup(file, { mode: 'merge', settings: false })
    expect(summary.sessions).toEqual({ added: 3, updated: 0, unchanged: 0 })
    expect(await snapshot()).toEqual(before)
  })

  it('merging never loses newer local edits or local-only records', async () => {
    await seed()
    const file = JSON.stringify(await createBackup())
    await updateSession('b', { note: 'edited after backup' })
    await saveSession(session('d', null, null, 7_000_000))
    const summary = await importBackup(file, { mode: 'merge', settings: false })
    expect(summary.sessions).toEqual({ added: 0, updated: 0, unchanged: 3 })
    expect((await db.sessions.get('b'))!.note).toBe('edited after backup')
    expect(await db.sessions.get('d')).toBeDefined()
  })

  it('replace makes the database an exact copy of the backup', async () => {
    await seed()
    const before = await snapshot()
    const file = JSON.stringify(await createBackup())
    await saveSession(session('d', null, null, 7_000_000))
    await importBackup(file, { mode: 'replace', settings: false })
    expect(await snapshot()).toEqual(before)
  })

  it('a damaged file changes nothing', async () => {
    await seed()
    const before = await snapshot()
    const backup = await createBackup()
    ;(backup.data.sessions[0] as unknown as { startedAt: string }).startedAt = 'yesterday'
    await expect(importBackup(JSON.stringify(backup), { mode: 'replace', settings: false })).rejects.toThrow(/damaged/)
    expect(await snapshot()).toEqual(before)
  })
})
