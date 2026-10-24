import { useEffect, useRef, useState } from 'react'
import { addProject } from '../../data/tasks'
import { projectColor, type Project, type Task } from '../../data/model'

export interface TaskDraft {
  title: string
  est: number
  projectId: string | null
  notes: string
}

const NEW_PROJECT = '__new__'

/** Inline add/edit form. Enter saves, Escape cancels. */
export function TaskForm({
  initial,
  projects,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: Task
  projects: Project[]
  onSave: (d: TaskDraft) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [est, setEst] = useState(initial?.est ?? 1)
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showNotes, setShowNotes] = useState(!!initial?.notes)
  const [newProject, setNewProject] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const idp = initial?.id ?? 'new'

  useEffect(() => titleRef.current?.focus(), [])

  async function save() {
    if (!title.trim()) return titleRef.current?.focus()
    let pid = projectId
    if (newProject !== null && newProject.trim()) pid = (await addProject(newProject)).id
    onSave({ title, est, projectId: pid, notes })
  }

  const live = projects.filter((p) => !p.archived || p.id === projectId)
  const current = live.find((p) => p.id === projectId)

  return (
    <form
      className="rounded-xl border-2 border-line bg-surface p-3 sm:p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <label htmlFor={`task-title-${idp}`} className="sr-only">Task</label>
      <input
        id={`task-title-${idp}`}
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What are you working on?"
        maxLength={200}
        className="w-full bg-transparent text-lg font-semibold outline-none placeholder:font-normal placeholder:text-faint"
      />

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div id={`est-${idp}`} className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted">Est. pomodoros</div>
          <div className="flex items-center gap-1.5" role="group" aria-labelledby={`est-${idp}`}>
            <button type="button" className="btn size-9 text-lg" onClick={() => setEst(Math.max(1, est - 1))} aria-label="One fewer">−</button>
            <input
              aria-labelledby={`est-${idp}`}
              type="number"
              min={1}
              max={50}
              value={est}
              onChange={(e) => e.target.value !== '' && setEst(Math.min(50, Math.max(1, Math.round(+e.target.value))))}
              className="w-14 rounded-lg border-2 border-line bg-bg px-1 py-1.5 text-center font-mono tabular-nums outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
            />
            <button type="button" className="btn size-9 text-lg" onClick={() => setEst(Math.min(50, est + 1))} aria-label="One more">+</button>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <label htmlFor={`proj-${idp}`} className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-muted">Project</label>
          {newProject === null ? (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full border border-line" style={{ background: current ? projectColor(current.color) : 'transparent' }} />
              <select
                id={`proj-${idp}`}
                value={projectId ?? ''}
                onChange={(e) => (e.target.value === NEW_PROJECT ? setNewProject('') : setProjectId(e.target.value || null))}
                className="w-full appearance-none rounded-lg border-2 border-line bg-bg py-2 pr-8 pl-8 font-medium outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
              >
                <option value="">No project</option>
                {live.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value={NEW_PROJECT}>+ New project…</option>
              </select>
              <svg className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 4.5l3 3 3-3" /></svg>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                id={`proj-${idp}`}
                autoFocus
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                placeholder="Project name"
                maxLength={60}
                className="min-w-0 flex-1 rounded-lg border-2 border-line bg-bg px-3 py-2 outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
              />
              <button type="button" className="btn px-3 text-sm" onClick={() => setNewProject(null)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {showNotes ? (
        <div className="mt-3">
          <label htmlFor={`notes-${idp}`} className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-muted">Notes</label>
          <textarea
            id={`notes-${idp}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full resize-y rounded-lg border-2 border-line bg-bg px-3 py-2 outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
          />
        </div>
      ) : (
        <button type="button" className="mt-3 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline" onClick={() => setShowNotes(true)}>
          + Add note
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-line/10 pt-3">
        {onDelete && (
          <button type="button" className="mr-auto rounded-lg px-2 py-1.5 text-sm font-semibold text-[var(--vermilion)] hover:underline" onClick={onDelete}>
            Delete
          </button>
        )}
        <span className="ml-auto" />
        <button type="button" className="btn px-4 py-2 text-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn bg-fg px-5 py-2 text-sm text-bg">Save</button>
      </div>
    </form>
  )
}
