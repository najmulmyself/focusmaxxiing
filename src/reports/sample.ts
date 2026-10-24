import { db } from '../data/db'
import type { Project, Task } from '../data/model'
import type { SessionRecord } from '../timer/engine'
import { addDays, startOfDay } from './stats'

/**
 * Example history so the reports can be explored before there's real data.
 * Every sample record has an id starting with `sample-` and device `sample`,
 * so it can be removed completely and is never confused with real sessions.
 */
const PREFIX = 'sample-'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const NOTES = [
  'Outlined the chapter', 'Fixed the flaky test', 'Drafted the intro', 'Cleared review comments', 'Worked through problem set',
  'Wrote the migration', 'Edited section 2', 'Read two papers', 'Sketched the onboarding flow', '',
]

export async function hasSample() {
  return (await db.sessions.where('id').startsWith(PREFIX).count()) > 0
}

export async function loadSample(now = Date.now(), days = 150) {
  const r = rng(42)
  const t0 = Date.now()
  const projects: Project[] = [
    ['Deep work', 1],
    ['Study', 2],
    ['Writing', 4],
    ['Admin', 5],
  ].map(([name, color], i) => ({ id: `${PREFIX}p${i}`, name: `${name} (sample)`, color: color as number, archived: false, order: 100 + i, createdAt: t0, updatedAt: t0 }))

  const tasks: Task[] = []
  const sessions: SessionRecord[] = []
  let taskN = 0
  let current: { task: Task; left: number } | null = null

  const newTask = (day: number): Task => {
    const p = projects[Math.floor(r() * projects.length)]
    const est = 1 + Math.floor(r() * 5)
    const titles: Record<string, string[]> = {
      [projects[0].id]: ['Sync engine refactor', 'Profile slow query', 'Ship export endpoint', 'Review auth PR'],
      [projects[1].id]: ['Linear algebra ch. 4', 'Spaced repetition deck', 'Read “Deep Work” notes', 'Statistics problem set'],
      [projects[2].id]: ['Essay draft', 'Newsletter issue', 'Edit chapter 3', 'Landing page copy'],
      [projects[3].id]: ['Inbox to zero', 'Expense report', 'Plan next week'],
    }
    const pool = titles[p.id]
    const t: Task = {
      id: `${PREFIX}t${taskN++}`, title: pool[Math.floor(r() * pool.length)], notes: '', projectId: p.id, est,
      done: false, doneAt: null, order: 1000 + taskN, createdAt: day, updatedAt: day, deletedAt: day + 1, // hidden from the live list
    }
    tasks.push(t)
    return t
  }

  for (let i = days; i >= 1; i--) {
    const day = addDays(startOfDay(now), -i)
    const dow = new Date(day).getDay()
    const weekend = dow === 0 || dow === 6
    // habit grows over the period; some days off
    const ramp = 0.45 + 0.55 * (1 - i / days)
    if (r() > (weekend ? 0.35 : 0.88)) continue
    const count = Math.max(1, Math.round((weekend ? 2 : 3 + r() * 6) * ramp))
    let t = day + (8.5 + r() * 2) * 3_600_000
    for (let k = 0; k < count; k++) {
      if (!current || current.left <= 0) {
        if (current) {
          current.task.done = true
          current.task.doneAt = t
        }
        const task = newTask(day)
        // people tend to under-estimate: actual drifts above estimate
        current = { task, left: Math.max(1, Math.round(task.est * (0.8 + r() * 0.8))) }
      }
      const abandoned = r() < 0.08
      const minutes = abandoned ? 5 + Math.floor(r() * 15) : 25
      const pauses = r() < 0.2 ? 1 : 0
      const span = minutes + pauses * (2 + Math.floor(r() * 6))
      const rated = r() < 0.55
      sessions.push({
        id: `${PREFIX}s${sessions.length}`, mode: 'focus', status: abandoned ? 'abandoned' : 'completed',
        plannedSec: 1500, actualSec: minutes * 60, startedAt: t, endedAt: t + span * 60_000, pauses,
        taskId: current.task.id, projectId: current.task.projectId,
        note: rated && !abandoned ? NOTES[Math.floor(r() * NOTES.length)] : '',
        quality: rated ? 2 + Math.round(r() * 3) : null,
        device: 'sample', createdAt: t, revision: 1, deletedAt: null,
      })
      if (!abandoned) current.left--
      t += span * 60_000
      const long = (k + 1) % 4 === 0
      const brk = long ? 15 : 5
      sessions.push({
        id: `${PREFIX}s${sessions.length}`, mode: long ? 'long' : 'short', status: 'completed', plannedSec: brk * 60, actualSec: brk * 60,
        startedAt: t, endedAt: t + brk * 60_000, pauses: 0, taskId: null, projectId: null, note: '', quality: null,
        device: 'sample', createdAt: t, revision: 1, deletedAt: null,
      })
      t += brk * 60_000
      // lunch
      if (k === Math.floor(count / 2)) t += (45 + r() * 60) * 60_000
    }
  }

  await db.transaction('rw', db.projects, db.tasks, db.sessions, async () => {
    await db.projects.bulkPut(projects)
    await db.tasks.bulkPut(tasks)
    await db.sessions.bulkPut(sessions)
  })
}

export async function removeSample() {
  await db.transaction('rw', db.projects, db.tasks, db.sessions, async () => {
    await db.sessions.where('id').startsWith(PREFIX).delete()
    await db.tasks.where('id').startsWith(PREFIX).delete()
    await db.projects.where('id').startsWith(PREFIX).delete()
  })
}
