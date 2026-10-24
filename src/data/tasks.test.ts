import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, saveSession, updateSession } from './db'
import { activeTasks, addProject, addTask, applyTemplate, clearFinished, deleteTask, pomodoroCounts, reorderTasks, saveTemplate, setDone } from './tasks'
import type { SessionRecord } from '../timer/engine'

const session = (id: string, taskId: string | null, status: SessionRecord['status'] = 'completed'): SessionRecord => ({
  id, mode: 'focus', status, plannedSec: 1500, actualSec: 1500, startedAt: 1, endedAt: 2, pauses: 0,
  taskId, projectId: null, note: '', quality: null, device: 't', createdAt: 2, revision: 1,
})

describe('tasks', () => {
  beforeEach(async () => {
    await Promise.all([db.tasks.clear(), db.projects.clear(), db.templates.clear(), db.sessions.clear()])
  })

  it('adds in order and reorders', async () => {
    const a = await addTask({ title: ' Write ', est: 3 })
    const b = await addTask({ title: 'Read' })
    expect(a.title).toBe('Write')
    expect(activeTasks(await db.tasks.toArray()).map((t) => t.title)).toEqual(['Write', 'Read'])
    await reorderTasks([b.id, a.id])
    expect(activeTasks(await db.tasks.toArray()).map((t) => t.title)).toEqual(['Read', 'Write'])
  })

  it('soft-deletes, and clears only finished tasks', async () => {
    const a = await addTask({ title: 'A' })
    const b = await addTask({ title: 'B' })
    const c = await addTask({ title: 'C' })
    await deleteTask(a.id)
    await setDone(b.id, true)
    await clearFinished()
    expect(activeTasks(await db.tasks.toArray()).map((t) => t.id)).toEqual([c.id])
    expect(await db.tasks.count()).toBe(3) // nothing is hard-deleted
  })

  it('counts completed focus sessions per task', async () => {
    const a = await addTask({ title: 'A' })
    await saveSession(session('s1', a.id))
    await saveSession(session('s2', a.id))
    await saveSession(session('s3', a.id, 'abandoned'))
    expect((await pomodoroCounts([a.id])).get(a.id)).toBe(2)
  })

  it('gives projects distinct colours until the palette runs out', async () => {
    const colors = []
    for (let i = 0; i < 7; i++) colors.push((await addProject(`P${i}`)).color)
    expect(new Set(colors.slice(0, 6)).size).toBe(6)
  })

  it('saves and applies templates', async () => {
    const p = await addProject('Work')
    await addTask({ title: 'Standup', est: 1, projectId: p.id })
    await addTask({ title: 'Deep work', est: 4, projectId: p.id })
    const tpl = await saveTemplate('Workday', activeTasks(await db.tasks.toArray()))
    await applyTemplate(tpl.id)
    const all = activeTasks(await db.tasks.toArray())
    expect(all).toHaveLength(4)
    expect(all[3]).toMatchObject({ title: 'Deep work', est: 4, projectId: p.id, done: false })
  })

  it('edits session notes with a new revision', async () => {
    await saveSession(session('s1', null))
    await updateSession('s1', { note: 'Shipped the draft', quality: 4 })
    expect(await db.sessions.get('s1')).toMatchObject({ note: 'Shipped the draft', quality: 4, revision: 2 })
  })
})
