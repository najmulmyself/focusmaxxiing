import { db } from './db'
import { uid } from './local'
import { PROJECT_COLORS, type Project, type Task, type Template, type TemplateItem } from './model'

const now = () => Date.now()

export const activeTasks = (all: Task[]) => all.filter((t) => !t.deletedAt).sort((a, b) => a.order - b.order)

async function nextOrder() {
  const last = await db.tasks.orderBy('order').last()
  return (last?.order ?? 0) + 1
}

export async function addTask(input: { title: string; est?: number; projectId?: string | null; notes?: string }): Promise<Task> {
  const t: Task = {
    id: uid(),
    title: input.title.trim(),
    notes: input.notes?.trim() ?? '',
    projectId: input.projectId ?? null,
    est: Math.max(1, Math.round(input.est ?? 1)),
    done: false,
    doneAt: null,
    order: await nextOrder(),
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  }
  await db.tasks.add(t)
  return t
}

export async function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'notes' | 'projectId' | 'est'>>) {
  const clean = { ...patch }
  if (clean.title !== undefined) clean.title = clean.title.trim()
  if (clean.est !== undefined) clean.est = Math.max(1, Math.round(clean.est))
  await db.tasks.update(id, { ...clean, updatedAt: now() })
}

export async function setDone(id: string, done: boolean) {
  await db.tasks.update(id, { done, doneAt: done ? now() : null, updatedAt: now() })
}

export async function deleteTask(id: string) {
  await db.tasks.update(id, { deletedAt: now(), updatedAt: now() })
}

export async function restoreTask(id: string) {
  await db.tasks.update(id, { deletedAt: null, updatedAt: now() })
}

/** Persist a new order for the given ids (the visible list, top to bottom). */
export async function reorderTasks(ids: string[]) {
  await db.transaction('rw', db.tasks, async () => {
    await Promise.all(ids.map((id, i) => db.tasks.update(id, { order: i + 1 })))
  })
}

export async function clearFinished() {
  const t = now()
  await db.tasks.filter((x) => x.done && !x.deletedAt).modify({ deletedAt: t, updatedAt: t })
}

export async function clearAll() {
  const t = now()
  await db.tasks.filter((x) => !x.deletedAt).modify({ deletedAt: t, updatedAt: t })
}

/* projects */

export async function addProject(name: string, color?: number): Promise<Project> {
  const all = await db.projects.toArray()
  const used = new Set(all.filter((p) => !p.archived).map((p) => p.color))
  const free = Array.from({ length: PROJECT_COLORS }, (_, i) => i + 1).find((c) => !used.has(c))
  const p: Project = {
    id: uid(),
    name: name.trim(),
    color: color ?? free ?? (all.length % PROJECT_COLORS) + 1,
    archived: false,
    order: all.length + 1,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.projects.add(p)
  return p
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'archived'>>) {
  await db.projects.update(id, { ...patch, updatedAt: now() })
}

/* templates */

export async function saveTemplate(name: string, tasks: Task[]): Promise<Template> {
  const items: TemplateItem[] = tasks.map((t) => ({ title: t.title, est: t.est, projectId: t.projectId, notes: t.notes }))
  const tpl: Template = { id: uid(), name: name.trim(), items, createdAt: now(), updatedAt: now() }
  await db.templates.add(tpl)
  return tpl
}

export async function applyTemplate(id: string) {
  const tpl = await db.templates.get(id)
  if (!tpl) return
  for (const item of tpl.items) await addTask(item)
}

export async function deleteTemplate(id: string) {
  await db.templates.delete(id)
}

/** Completed focus sessions per task id. */
export async function pomodoroCounts(taskIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!taskIds.length) return counts
  const rows = await db.sessions.where('taskId').anyOf(taskIds).toArray()
  for (const r of rows) if (r.mode === 'focus' && r.status === 'completed' && r.taskId && !r.deletedAt) counts.set(r.taskId, (counts.get(r.taskId) ?? 0) + 1)
  return counts
}
