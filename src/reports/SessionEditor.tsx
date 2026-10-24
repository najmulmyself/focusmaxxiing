import { useState } from 'react'
import { Modal } from '../app/Modal'
import { db, deleteSession, saveSession, updateSession } from '../data/db'
import { deviceId, uid } from '../data/local'
import type { Project, Task } from '../data/model'
import type { Mode, Outcome, SessionRecord } from '../timer/engine'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const timeValue = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function parseLocal(date: string, time: string): number | null {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  if (![y, m, d, h, min].every(Number.isFinite)) return null
  return new Date(y, m - 1, d, h, min).getTime()
}

const input = 'w-full rounded-lg border-2 border-line bg-bg px-3 py-2 outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]'
const label = 'mb-1 block font-mono text-[11px] uppercase tracking-widest text-muted'

/**
 * Edit a logged session, or (record = null) add one by hand — for a timer you
 * forgot to start. Saved edits bump the session's revision.
 */
export function SessionEditor({
  record,
  tasks,
  projects,
  onClose,
  onDeleted,
}: {
  record: SessionRecord | null
  tasks: Task[]
  projects: Project[]
  onClose: () => void
  onDeleted: (r: SessionRecord) => void
}) {
  const now = Date.now()
  const defStart = record?.startedAt ?? now - 25 * 60_000
  const [date, setDate] = useState(dateValue(defStart))
  const [time, setTime] = useState(timeValue(defStart))
  const [minutes, setMinutes] = useState(String(record ? Math.round(record.actualSec / 60) : 25))
  const [mode, setMode] = useState<Mode>(record?.mode ?? 'focus')
  const [status, setStatus] = useState<Outcome>(record?.status ?? 'completed')
  const [taskId, setTaskId] = useState(record?.taskId ?? '')
  const [projectId, setProjectId] = useState(record?.projectId ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [quality, setQuality] = useState<number | null>(record?.quality ?? null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const taskOptions = tasks.filter((t) => !t.deletedAt || t.id === taskId)

  async function save() {
    const start = parseLocal(date, time)
    const min = Number(minutes)
    if (start === null) return setError('Enter a valid date and start time.')
    if (!Number.isFinite(min) || min < 1 || min > 600) return setError('Length must be between 1 and 600 minutes.')
    if (start + min * 60_000 > Date.now() + 60_000) return setError('That session would end in the future.')
    const focus = mode === 'focus'
    const task = focus && taskId ? tasks.find((t) => t.id === taskId) : undefined
    const fields = {
      mode,
      status,
      startedAt: start,
      // keep paused time for an edited session whose length didn't change; otherwise assume no pauses
      endedAt: record && Math.round(record.actualSec / 60) === min && record.startedAt === start ? record.endedAt : start + min * 60_000,
      actualSec: record && Math.round(record.actualSec / 60) === min ? record.actualSec : min * 60,
      taskId: focus ? taskId || null : null,
      projectId: focus ? (task?.projectId ?? (projectId || null)) : null,
      note: note.trim(),
      quality: focus ? quality : null,
    }
    if (record) {
      await updateSession(record.id, fields)
    } else {
      await saveSession({
        id: uid(),
        plannedSec: min * 60,
        pauses: 0,
        device: `${deviceId()} (manual)`,
        createdAt: Date.now(),
        revision: 1,
        deletedAt: null,
        ...fields,
      })
    }
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={record ? 'Edit session' : 'Add a session'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {!record && <p className="-mt-2 text-sm text-muted">Forgot to start the timer? Log it here. It counts like any other session.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="se-date" className={label}>Date</label>
            <input id="se-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="se-time" className={label}>Start</label>
            <input id="se-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} required />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="se-min" className={label}>Minutes focused</label>
            <input id="se-min" type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${input} font-mono tabular-nums`} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="se-mode" className={label}>Type</label>
            <select id="se-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
              <option value="focus">Focus</option>
              <option value="short">Short break</option>
              <option value="long">Long break</option>
            </select>
          </div>
          <div>
            <label htmlFor="se-status" className={label}>Outcome</label>
            <select id="se-status" value={status} onChange={(e) => setStatus(e.target.value as Outcome)} className={input}>
              <option value="completed">Completed</option>
              <option value="skipped">Skipped early</option>
              <option value="abandoned">Unfinished</option>
            </select>
          </div>
        </div>

        {mode === 'focus' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="se-task" className={label}>Task</label>
                <select id="se-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className={input}>
                  <option value="">No task</option>
                  {taskOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}{t.done ? ' ✓' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="se-project" className={label}>Project</label>
                <select
                  id="se-project"
                  value={taskId ? (tasks.find((t) => t.id === taskId)?.projectId ?? '') : projectId}
                  disabled={!!taskId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className={`${input} disabled:opacity-60`}
                  title={taskId ? 'Set by the task' : undefined}
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <span id="se-q" className={label}>Focus rating</span>
              <div role="radiogroup" aria-labelledby="se-q" className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((q) => (
                  <button key={q} type="button" role="radio" aria-checked={quality === q} onClick={() => setQuality(quality === q ? null : q)} className="btn size-9 font-mono text-sm aria-checked:bg-fg aria-checked:text-bg">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <label htmlFor="se-note" className={label}>Note</label>
          <input id="se-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What got done" className={input} />
        </div>

        {error && <p role="alert" className="text-sm font-semibold text-[var(--vermilion)]">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t-2 border-line/10 pt-4">
          {record &&
            (confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-sm">
                Delete this session?
                <button type="button" className="btn px-3 py-1.5 text-sm" onClick={() => setConfirmDelete(false)}>No</button>
                <button
                  type="button"
                  className="btn btn-accent px-3 py-1.5 text-sm"
                  data-mode="focus"
                  onClick={async () => {
                    await deleteSession(record.id)
                    onDeleted(record)
                    onClose()
                  }}
                >
                  Delete
                </button>
              </span>
            ) : (
              <button type="button" className="mr-auto rounded-lg px-2 py-1.5 text-sm font-semibold text-[var(--vermilion)] hover:underline" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
          <span className="ml-auto" />
          <button type="button" className="btn px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bg-fg px-5 py-2 text-sm text-bg">{record ? 'Save' : 'Add session'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Tasks for pickers: everything, newest first (cleared tasks stay so old sessions can keep their task). */
export const allTasks = () => db.tasks.orderBy('order').reverse().toArray()
