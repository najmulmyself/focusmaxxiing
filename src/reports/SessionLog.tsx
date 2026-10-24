import { useMemo, useState } from 'react'
import { projectColor, type Project, type Task } from '../data/model'
import type { SessionRecord } from '../timer/engine'
import { fmtDuration } from './stats'

const MODE_NAME = { focus: 'Focus', short: 'Short break', long: 'Long break' } as const
const STATUS_NAME = { completed: 'Completed', skipped: 'Skipped', abandoned: 'Unfinished' } as const
const PAGE = 50

type ModeFilter = 'all' | 'focus' | 'breaks'

/** Every session in the range, newest first: searchable, filterable, editable. */
export function SessionLog({
  sessions,
  tasks,
  projects,
  onEdit,
  onAdd,
}: {
  sessions: SessionRecord[]
  tasks: Map<string, Task>
  projects: Map<string, Project>
  onEdit: (s: SessionRecord) => void
  onAdd: () => void
}) {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<ModeFilter>('focus')
  const [limit, setLimit] = useState(PAGE)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sessions
      .filter((s) => (mode === 'all' ? true : mode === 'focus' ? s.mode === 'focus' : s.mode !== 'focus'))
      .filter((s) => {
        if (!needle) return true
        const hay = [s.note, s.taskId && tasks.get(s.taskId)?.title, s.projectId && projects.get(s.projectId)?.name, STATUS_NAME[s.status], MODE_NAME[s.mode]].join(' ').toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => b.startedAt - a.startedAt)
  }, [sessions, q, mode, tasks, projects])

  let lastDay = ''
  return (
    <section aria-labelledby="log-h" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="log-h" className="display text-2xl font-semibold">Session log</h2>
        <button className="btn px-4 py-2 text-sm" onClick={onAdd}>+ Add session</button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="log-q" className="sr-only">Search sessions</label>
        <input
          id="log-q"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setLimit(PAGE)
          }}
          placeholder="Search notes, tasks, projects"
          className="min-w-0 flex-1 basis-56 rounded-lg border-2 border-line bg-bg px-3 py-2 outline-none focus:shadow-[0_0_0_3px_var(--vermilion)]"
        />
        <div role="radiogroup" aria-label="Session type" className="flex gap-1.5">
          {(['focus', 'breaks', 'all'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className="btn px-3 py-1.5 text-sm capitalize aria-checked:bg-fg aria-checked:text-bg">
              {m}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{sessions.length ? 'No sessions match.' : 'No sessions in this period.'}</p>
      ) : (
        <div className="relative mt-4 -mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted">
                <th className="px-2 py-2 font-normal">Time</th>
                <th className="px-2 py-2 font-normal">Length</th>
                <th className="px-2 py-2 font-normal">Task · project</th>
                <th className="px-2 py-2 font-normal">Rating</th>
                <th className="px-2 py-2 font-normal">Note</th>
                <th className="px-2 py-2"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).flatMap((s) => {
                const day = new Date(s.startedAt).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
                const header = day !== lastDay
                lastDay = day
                const task = s.taskId ? tasks.get(s.taskId) : undefined
                const project = s.projectId ? projects.get(s.projectId) : undefined
                const out = []
                if (header)
                  out.push(
                    <tr key={`d-${s.id}`}>
                      <td colSpan={6} className="px-2 pt-4 pb-1 font-semibold">{day}</td>
                    </tr>,
                  )
                out.push(
                  <tr key={s.id} className="group">
                    <td className="border-t border-line/10 px-2 py-2 font-mono text-xs whitespace-nowrap tabular-nums text-muted">
                      {new Date(s.startedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="border-t border-line/10 px-2 py-2 whitespace-nowrap">
                      <span className="font-mono tabular-nums">{fmtDuration(s.actualSec)}</span>
                      {s.status !== 'completed' && (
                        <span className="ml-2 rounded-full border-2 border-line/40 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">{STATUS_NAME[s.status]}</span>
                      )}
                    </td>
                    <td className="max-w-64 border-t border-line/10 px-2 py-2">
                      {s.mode !== 'focus' ? (
                        <span className="text-muted">{MODE_NAME[s.mode]}</span>
                      ) : (
                        <span className="flex min-w-0 items-center gap-2">
                          {project && <span className="size-2.5 shrink-0 rounded-full" style={{ background: projectColor(project.color) }} />}
                          <span className="truncate">
                            {task?.title ?? <span className="text-muted">No task</span>}
                            {project && <span className="text-muted"> · {project.name}</span>}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="border-t border-line/10 px-2 py-2 font-mono text-xs whitespace-nowrap" aria-label={s.quality ? `${s.quality} of 5` : 'Not rated'}>
                      {s.quality ? <span><span className="text-[var(--series-1)]">{'●'.repeat(s.quality)}</span><span className="text-faint">{'○'.repeat(5 - s.quality)}</span></span> : <span className="text-faint">—</span>}
                    </td>
                    <td className="max-w-72 truncate border-t border-line/10 px-2 py-2 text-muted" title={s.note}>{s.note}</td>
                    <td className="border-t border-line/10 px-2 py-1 text-right">
                      <button className="rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:bg-[var(--paper-2)] hover:text-fg" onClick={() => onEdit(s)} aria-label={`Edit session at ${new Date(s.startedAt).toLocaleString('en')}`}>
                        Edit
                      </button>
                    </td>
                  </tr>,
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button className="btn mt-4 w-full py-2.5 text-sm" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, rows.length - limit)} more · {rows.length - limit} left
        </button>
      )}
    </section>
  )
}
