import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../../data/db'
import { projectColor, type Project, type Task } from '../../data/model'
import { activeTasks, addTask, applyTemplate, clearAll, clearFinished, deleteTask, deleteTemplate, pomodoroCounts, reorderTasks, restoreTask, saveTemplate, setDone, updateTask } from '../../data/tasks'
import { useLive } from '../../data/useLive'
import { estimateFinish } from '../../timer/plan'
import type { TimerApi } from '../../timer/useTimer'
import type { Settings } from '../../timer/settings'
import { TaskForm } from './TaskForm'

const fmtDur = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function TasksPanel({ t, settings, onToast, onTaskDone }: { t: TimerApi; settings: Settings; onToast: (text: string, undo?: () => void) => void; onTaskDone: () => void }) {
  const tasks = useLive(() => db.tasks.toArray().then(activeTasks), [], null as Task[] | null)
  const projects = useLive(() => db.projects.orderBy('order').toArray(), [], [] as Project[])
  const ids = tasks?.map((x) => x.id).join(',') ?? ''
  const counts = useLive(() => pomodoroCounts(ids ? ids.split(',') : []), [ids], new Map<string, number>())

  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [menu, setMenu] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)

  const activeId = t.state.taskId
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const list = useMemo(() => {
    if (!tasks) return []
    if (!order) return tasks
    const m = new Map(tasks.map((x) => [x.id, x]))
    return order.map((id) => m.get(id)).filter((x): x is Task => !!x)
  }, [tasks, order])

  // the selected task disappeared (deleted elsewhere, cleared): drop the selection
  useEffect(() => {
    if (tasks && activeId && !tasks.some((x) => x.id === activeId)) t.selectTask(null, null)
  }, [tasks, activeId]) // t.selectTask is stable in behaviour; omitted to avoid a loop

  const totalEst = list.reduce((a, x) => a + x.est, 0)
  const totalAct = list.reduce((a, x) => a + (counts.get(x.id) ?? 0), 0)
  const left = list.filter((x) => !x.done).reduce((a, x) => a + Math.max(0, x.est - (counts.get(x.id) ?? 0)), 0)
  const finish = estimateFinish(left, t.state, settings, t.now)
  const hasDone = list.some((x) => x.done)

  function select(task: Task) {
    if (task.id === activeId) return
    t.selectTask(task.id, task.projectId)
  }

  async function toggleDone(task: Task) {
    await setDone(task.id, !task.done)
    if (!task.done) onTaskDone()
  }

  async function remove(task: Task) {
    setEditing(null)
    await deleteTask(task.id)
    onToast(`Deleted “${task.title}”.`, () => void restoreTask(task.id))
  }

  function onDrop() {
    if (order) void reorderTasks(order)
    setDragId(null)
    setTimeout(() => setOrder(null), 50)
  }

  return (
    <section aria-labelledby="tasks-h" className="card p-5 text-fg sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="tasks-h" className="display text-2xl font-semibold">Tasks</h2>
        <div className="relative">
          <button className="btn size-9" aria-label="Task list options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden><circle cx="3" cy="8" r="1.6" /><circle cx="8" cy="8" r="1.6" /><circle cx="13" cy="8" r="1.6" /></svg>
          </button>
          {menu && <ListMenu tasks={list} hasDone={hasDone} onClose={() => setMenu(false)} onToast={onToast} />}
        </div>
      </div>

      {tasks === null ? null : (
        <ul className="mt-4 flex flex-col gap-2" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {list.map((task) =>
            editing === task.id ? (
              <li key={task.id}>
                <TaskForm
                  initial={task}
                  projects={projects}
                  onCancel={() => setEditing(null)}
                  onDelete={() => void remove(task)}
                  onSave={async (d) => {
                    await updateTask(task.id, d)
                    if (task.id === activeId) t.selectTask(task.id, d.projectId)
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <TaskRow
                key={task.id}
                task={task}
                project={task.projectId ? byId.get(task.projectId) : undefined}
                act={counts.get(task.id) ?? 0}
                active={task.id === activeId}
                dragging={dragId === task.id}
                onSelect={() => select(task)}
                onToggle={() => void toggleDone(task)}
                onEdit={() => setEditing(task.id)}
                onDragStart={() => {
                  setDragId(task.id)
                  setOrder(list.map((x) => x.id))
                }}
                onDragEnter={() => {
                  if (!dragId || dragId === task.id || !order) return
                  const next = order.filter((id) => id !== dragId)
                  next.splice(next.indexOf(task.id) + (order.indexOf(dragId) < order.indexOf(task.id) ? 1 : 0), 0, dragId)
                  setOrder(next)
                }}
                onDragEnd={onDrop}
              />
            ),
          )}
        </ul>
      )}

      {editing === 'new' ? (
        <div className="mt-2">
          <TaskForm
            projects={projects}
            onCancel={() => setEditing(null)}
            onSave={async (d) => {
              const task = await addTask(d)
              if (!activeId) t.selectTask(task.id, task.projectId)
              setEditing(null)
            }}
          />
        </div>
      ) : (
        <button
          className="mt-2 w-full rounded-xl border-2 border-dashed border-line/40 py-3 text-sm font-semibold text-muted transition-colors hover:border-line hover:text-fg"
          onClick={() => setEditing('new')}
        >
          + Add task
        </button>
      )}

      {list.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t-2 border-line/10 pt-4 font-mono text-xs uppercase tracking-widest text-muted">
          <div className="flex gap-2"><dt>Pomos</dt><dd className="text-fg tabular-nums">{totalAct}/{totalEst}</dd></div>
          {left > 0 ? (
            <div className="flex gap-2"><dt>Finish at</dt><dd className="text-fg tabular-nums">{fmtTime(finish.endsAt)} <span className="text-muted">({fmtDur(finish.totalMs)})</span></dd></div>
          ) : (
            <div className="text-fg">All estimates done</div>
          )}
        </dl>
      )}
    </section>
  )
}

function TaskRow({
  task, project, act, active, dragging, onSelect, onToggle, onEdit, onDragStart, onDragEnter, onDragEnd,
}: {
  task: Task; project?: Project; act: number; active: boolean; dragging: boolean
  onSelect: () => void; onToggle: () => void; onEdit: () => void
  onDragStart: () => void; onDragEnter: () => void; onDragEnd: () => void
}) {
  const over = act > task.est
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-3 rounded-xl border-2 border-line bg-surface px-3 py-2.5 transition-[box-shadow,opacity] sm:px-4 ${active ? 'shadow-[inset_6px_0_0_var(--vermilion)]' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      <button
        role="checkbox"
        aria-checked={task.done}
        aria-label={`Mark “${task.title}” ${task.done ? 'not done' : 'done'}`}
        onClick={onToggle}
        className={`grid size-6 shrink-0 place-items-center rounded-full border-2 border-line transition-colors ${task.done ? 'bg-ink text-paper' : 'hover:bg-[var(--paper-2)]'}`}
      >
        {task.done && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.2 2.2L9.5 3.5" /></svg>}
      </button>

      {project && <span className="size-2.5 shrink-0 rounded-full sm:hidden" style={{ background: projectColor(project.color) }} title={project.name} />}
      <button onClick={onSelect} className="min-w-0 flex-1 text-left" aria-pressed={active} aria-label={`Work on “${task.title}”`}>
        <span className={`block truncate font-medium ${task.done ? 'text-faint line-through' : ''}`}>{task.title}</span>
        {task.notes && <span className="block truncate text-sm text-muted">{task.notes}</span>}
      </button>

      {project && (
        <span className="hidden max-w-36 shrink-0 items-center gap-1.5 rounded-full border-2 border-line px-2 py-0.5 text-xs font-semibold sm:inline-flex">
          <span className="size-2 shrink-0 rounded-full" style={{ background: projectColor(project.color) }} />
          <span className="truncate">{project.name}</span>
        </span>
      )}

      <span className={`shrink-0 font-mono text-sm tabular-nums ${over ? 'text-[var(--vermilion)]' : 'text-muted'}`} title={`${act} of ${task.est} pomodoros`}>
        <span className="text-fg">{act}</span>/{task.est}
      </span>

      <button onClick={onEdit} className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--paper-2)] hover:text-fg" aria-label={`Edit “${task.title}”`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
      </button>
    </li>
  )
}

function ListMenu({ tasks, hasDone, onClose, onToast }: { tasks: Task[]; hasDone: boolean; onClose: () => void; onToast: (text: string) => void }) {
  const templates = useLive(() => db.templates.toArray(), [], [])
  const [naming, setNaming] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && closeRef.current()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    // attach on the next tick so the click that opened the menu doesn't close it
    const id = setTimeout(() => document.addEventListener('pointerdown', away))
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [])

  const item = 'block w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-[var(--paper-2)] disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div ref={ref} className="absolute right-0 z-20 mt-2 w-72 rounded-xl border-2 border-line bg-surface p-2 text-fg shadow-[0_4px_0_var(--line)]">
      <div className="px-3 pt-1 pb-1.5 font-mono text-[11px] uppercase tracking-widest text-muted">Templates</div>
      {templates.length === 0 && <p className="px-3 pb-2 text-sm text-muted">Save today&rsquo;s list to reuse it any day.</p>}
      {templates.map((tpl) => (
        <div key={tpl.id} className="flex items-center gap-1">
          <button
            className={`${item} min-w-0 flex-1 truncate`}
            onClick={async () => {
              await applyTemplate(tpl.id)
              onToast(`Added ${tpl.items.length} tasks from “${tpl.name}”.`)
              onClose()
            }}
          >
            {tpl.name} <span className="text-muted">· {tpl.items.length}</span>
          </button>
          <button className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--paper-2)] hover:text-fg" aria-label={`Delete template “${tpl.name}”`} onClick={() => void deleteTemplate(tpl.id)}>
            <svg width="12" height="12" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
      ))}
      {naming === null ? (
        <button className={item} disabled={!tasks.length} onClick={() => setNaming('')}>Save list as template…</button>
      ) : (
        <form
          className="flex gap-2 p-1"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!naming.trim()) return
            await saveTemplate(naming, tasks)
            onToast(`Saved template “${naming.trim()}”.`)
            onClose()
          }}
        >
          <label htmlFor="tpl-name" className="sr-only">Template name</label>
          <input id="tpl-name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="e.g. Workday" maxLength={60} className="min-w-0 flex-1 rounded-lg border-2 border-line bg-bg px-2 py-1.5 text-sm outline-none" />
          <button className="btn px-3 text-sm">Save</button>
        </form>
      )}
      <div className="my-2 border-t-2 border-line/10" />
      <button className={item} disabled={!hasDone} onClick={async () => { await clearFinished(); onClose() }}>Clear finished tasks</button>
      {confirmClear ? (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="flex-1">Clear all tasks?</span>
          <button className="btn px-2.5 py-1 text-sm" onClick={() => setConfirmClear(false)}>No</button>
          <button className="btn btn-accent px-2.5 py-1 text-sm" data-mode="focus" onClick={async () => { await clearAll(); onClose() }}>Clear</button>
        </div>
      ) : (
        <button className={item} disabled={!tasks.length} onClick={() => setConfirmClear(true)}>Clear all tasks…</button>
      )}
      <p className="px-3 pt-1 pb-1 text-xs text-muted">Cleared tasks keep their logged sessions.</p>
    </div>
  )
}
