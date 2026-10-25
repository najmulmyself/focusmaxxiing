import { useEffect, useMemo, useState } from 'react'
import { Pip } from '../mascot/Pip'
import { Modal } from '../app/Modal'
import { DataPanel } from '../app/DataPanel'
import { allSessions, db, restoreSession } from '../data/db'
import { useLive } from '../data/useLive'
import { projectColor, type Project, type Task } from '../data/model'
import { pomodoroCounts } from '../data/tasks'
import type { SessionRecord } from '../timer/engine'
import { HourBars, Legend, StackedBars, YearHeatmap, type Series } from './charts'
import { SessionEditor } from './SessionEditor'
import { SessionLog } from './SessionLog'
import { hasSample, loadSample, removeSample } from './sample'
import {
  bestWindow, bucketUnit, bucketsFor, byProject, customRange, dailyFocus, estimateAccuracy, focusByBucket, fmtDuration,
  hourProfile, periodRange, rangeLabel, shiftRange, streaks, totals, addDays, type Period, type Range,
} from './stats'

const PERIODS: [Exclude<Period, 'custom'>, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]
const PREV_NAME: Record<Period, string> = { day: 'yesterday', week: 'last week', month: 'last month', year: 'last year', custom: 'the period before' }
const NONE = '' // sessions without a project

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const parseDate = (v: string) => {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function Delta({ now, before, period }: { now: number; before: number; period: Period }) {
  if (!before && !now) return <span>&nbsp;</span>
  const diff = now - before
  if (Math.abs(diff) < 60) return <span>Same as {PREV_NAME[period]}</span>
  return (
    <span>
      <span className={diff > 0 ? 'text-[var(--series-2)]' : 'text-[var(--series-1)]'}>{diff > 0 ? '▲' : '▼'}</span> {fmtDuration(Math.abs(diff))} vs {PREV_NAME[period]}
    </span>
  )
}

export function ReportsPage() {
  const sessions = useLive(allSessions, [], null as SessionRecord[] | null)
  const tasks = useLive(() => db.tasks.toArray(), [], [] as Task[])
  const projects = useLive(() => db.projects.orderBy('order').toArray(), [], [] as Project[])
  const sample = useLive(hasSample, [], false)

  const [range, setRange] = useState<Range>(() => periodRange('week', Date.now()))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<SessionRecord | 'new' | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(id)
  }, [toast])

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const doneIds = tasks.filter((t) => t.done).map((t) => t.id).join(',')
  const counts = useLive(() => pomodoroCounts(doneIds ? doneIds.split(',') : []), [doneIds], new Map<string, number>())

  const all = sessions ?? []
  // project filter applies to every chart and tile; streaks stay global
  const visible = useMemo(() => all.filter((s) => s.mode !== 'focus' || !hidden.has(s.projectId ?? NONE)), [all, hidden])
  const inPeriod = useMemo(() => visible.filter((s) => s.startedAt < range.to && s.endedAt > range.from), [visible, range])

  const buckets = useMemo(() => bucketsFor(range), [range])
  const t = useMemo(() => totals(visible, range), [visible, range])
  const prev = useMemo(() => totals(visible, shiftRange(range, -1)), [visible, range])
  const streak = useMemo(() => streaks(all, Date.now()), [all])
  const perProject = useMemo(() => byProject(visible, range), [visible, range])
  const profile = useMemo(() => hourProfile(visible, range), [visible, range])
  const best = bestWindow(profile, 2)
  const accuracy = useMemo(() => estimateAccuracy(tasks.filter((x) => !hidden.has(x.projectId ?? NONE)), counts, range), [tasks, counts, range, hidden])
  const daily = useMemo(() => dailyFocus(visible), [visible])

  // series: projects that have focus in the period, in project order, then "No project"
  const usedKeys = new Set(all.filter((s) => s.mode === 'focus').map((s) => s.projectId ?? NONE))
  const filterable: Series[] = [
    ...projects.filter((p) => usedKeys.has(p.id)).map((p) => ({ key: p.id, name: p.name, color: projectColor(p.color) })),
    ...(usedKeys.has(NONE) ? [{ key: NONE, name: 'No project', color: 'var(--fg-faint)' }] : []),
  ]
  const series = filterable.filter((s) => (perProject.get(s.key) ?? 0) > 0)
  const byBucket = useMemo(() => focusByBucket(visible, buckets, (s) => s.projectId ?? NONE), [visible, buckets])

  const isEmpty = sessions !== null && all.length === 0
  const isNow = range.period !== 'custom' && Date.now() >= range.from && Date.now() < range.to
  const hourName = (h: number) => new Date(2026, 0, 1, h % 24).toLocaleTimeString('en', { hour: 'numeric' }).replace(' ', ' ').toLowerCase()

  return (
    <div className="grain min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-8">
        <a href="#/" className="display text-xl font-semibold tracking-tight">
          focusmaxxiing<span className="text-[var(--vermilion)]">.</span>
        </a>
        <div className="flex gap-2">
          <button className="btn px-4 py-2 text-sm" onClick={() => setExporting(true)}>Export</button>
          <a href="#/" className="btn px-4 py-2 text-sm">← Timer</a>
        </div>
      </header>

      <Modal open={exporting} onClose={() => setExporting(false)} title="Export & backup">
        <DataPanel range={{ from: range.from, to: range.to, label: rangeLabel(range) }} />
      </Modal>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6">
          <div>
            <h1 className="display text-5xl font-semibold sm:text-6xl">Reports</h1>
            <p className="mt-1 text-lg text-muted">{rangeLabel(range)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Period" className="flex gap-1.5">
              {PERIODS.map(([p, l]) => (
                <button key={p} role="radio" aria-checked={range.period === p} onClick={() => setRange(periodRange(p, anchorFor(range)))} className="btn px-3 py-1.5 text-sm aria-checked:bg-fg aria-checked:text-bg">
                  {l}
                </button>
              ))}
              <button role="radio" aria-checked={range.period === 'custom'} onClick={() => setRange(customRange(addDays(Date.now(), -13), Date.now()))} className="btn px-3 py-1.5 text-sm aria-checked:bg-fg aria-checked:text-bg">
                Custom
              </button>
            </div>
            <div className="flex gap-1.5">
              <button className="btn size-9" aria-label="Previous period" onClick={() => setRange(shiftRange(range, -1))}>‹</button>
              <button className="btn size-9" aria-label="Next period" onClick={() => setRange(shiftRange(range, 1))} disabled={range.to > Date.now()}>›</button>
              {range.period !== 'custom' && !isNow && (
                <button className="btn px-3 text-sm" onClick={() => setRange(periodRange(range.period as Exclude<Period, 'custom'>, Date.now()))}>
                  Now
                </button>
              )}
            </div>
          </div>
        </div>

        {range.period === 'custom' && (
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              From
              <input type="date" value={dateValue(range.from)} max={dateValue(addDays(range.to, -1))} onChange={(e) => e.target.value && setRange(customRange(parseDate(e.target.value), addDays(range.to, -1)))} className="mt-1 block rounded-lg border-2 border-line bg-surface px-3 py-1.5" />
            </label>
            <label className="text-sm font-semibold">
              To
              <input type="date" value={dateValue(addDays(range.to, -1))} min={dateValue(range.from)} onChange={(e) => e.target.value && setRange(customRange(range.from, parseDate(e.target.value)))} className="mt-1 block rounded-lg border-2 border-line bg-surface px-3 py-1.5" />
            </label>
          </div>
        )}

        {sample && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed border-line px-4 py-3">
            <span><b>You&rsquo;re looking at sample data.</b> <span className="text-muted">Projects marked “(sample)” and their sessions are examples, not yours.</span></span>
            <button className="btn px-4 py-1.5 text-sm" onClick={() => void removeSample()}>Remove sample data</button>
          </div>
        )}

        {isEmpty ? (
          <div className="card grid place-items-center gap-4 px-6 py-14 text-center">
            <Pip mood="sleepy" size={180} dozeAfter={0} />
            <h2 className="display text-3xl font-semibold">Nothing to report yet</h2>
            <p className="max-w-md text-muted">Reports fill in as you finish focus sessions. You can also explore them now with a few months of example data, and remove it with one click.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="#/" className="btn btn-accent px-5 py-2.5" data-mode="focus">Start focusing</a>
              <button
                className="btn px-5 py-2.5"
                disabled={loading}
                onClick={async () => {
                  setLoading(true)
                  await loadSample()
                  setLoading(false)
                }}
              >
                {loading ? 'Loading…' : 'Explore with sample data'}
              </button>
            </div>
          </div>
        ) : sessions === null ? null : (
          <div className="flex flex-col gap-4">
            {filterable.length > 1 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Projects shown">
                <span className="mr-1 font-mono text-xs uppercase tracking-widest text-muted">Projects</span>
                {filterable.map((s) => {
                  const on = !hidden.has(s.key)
                  return (
                    <button
                      key={s.key}
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(hidden)
                        if (on) next.add(s.key)
                        else next.delete(s.key)
                        if (next.size < filterable.length) setHidden(next)
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full border-2 border-line px-3 py-1 text-sm font-semibold transition-opacity ${on ? '' : 'opacity-45 line-through'}`}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </button>
                  )
                })}
                {hidden.size > 0 && <button className="text-sm font-semibold underline underline-offset-4" onClick={() => setHidden(new Set())}>Show all</button>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Tile k="Focus time" v={fmtDuration(t.focusSec)} sub={<Delta now={t.focusSec} before={prev.focusSec} period={range.period} />} wide />
              <Tile k="Pomodoros" v={String(t.pomodoros)} sub={t.activeDays ? `${t.activeDays} active ${t.activeDays === 1 ? 'day' : 'days'}` : 'No active days'} />
              <Tile k="Streak" v={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} sub={`Longest: ${streak.longest}`} />
              <Tile k="Completion" v={t.completionRate === null ? '—' : `${Math.round(t.completionRate * 100)}%`} sub={t.focusSessions ? `${t.abandoned} unfinished · ${t.skipped} skipped` : 'No focus sessions'} />
              <Tile k="Focus rating" v={t.avgQuality === null ? '—' : `${t.avgQuality.toFixed(1)} / 5`} sub={t.rated ? `${t.rated} rated sessions` : 'Rate sessions after you finish'} />
            </div>

            <section className="card p-5 sm:p-6" aria-labelledby="chart-h">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="chart-h" className="display text-2xl font-semibold">
                  Focus by {bucketUnit(range)}
                </h2>
                <Legend series={series} />
              </div>
              <div className="mt-4">
                <StackedBars buckets={buckets} data={byBucket} series={series} />
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <section className="card p-5 sm:p-6" aria-labelledby="hours-h">
                <h2 id="hours-h" className="display text-2xl font-semibold">When you focus</h2>
                <p className="mt-1 text-muted">
                  {best ? (
                    <>Your strongest two hours are <b className="text-fg">{hourName(best.start)}–{hourName(best.start + 2)}</b>, with {Math.round(best.share * 100)}% of your focus.</>
                  ) : (
                    'No focus in this period.'
                  )}
                </p>
                <div className="mt-4">
                  <HourBars profile={profile} highlight={best ? { start: best.start, width: 2 } : null} />
                </div>
              </section>

              <section className="card p-5 sm:p-6" aria-labelledby="proj-h">
                <h2 id="proj-h" className="display text-2xl font-semibold">Where it went</h2>
                {series.length === 0 ? (
                  <p className="mt-2 text-muted">No focus in this period.</p>
                ) : (
                  <ul className="mt-4 flex flex-col gap-3">
                    {[...series]
                      .sort((a, b) => (perProject.get(b.key) ?? 0) - (perProject.get(a.key) ?? 0))
                      .map((s) => {
                        const v = perProject.get(s.key) ?? 0
                        const share = t.focusSec ? v / t.focusSec : 0
                        return (
                          <li key={s.key}>
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="flex min-w-0 items-center gap-2 font-semibold"><span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.name}</span></span>
                              <span className="shrink-0 font-mono tabular-nums text-muted"><span className="text-fg">{fmtDuration(v)}</span> · {Math.round(share * 100)}%</span>
                            </div>
                            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_10%,transparent)]">
                              <div className="h-full rounded-full" style={{ width: `${Math.max(1, share * 100)}%`, background: s.color }} />
                            </div>
                          </li>
                        )
                      })}
                  </ul>
                )}
              </section>
            </div>

            <section className="card p-5 sm:p-6" aria-labelledby="acc-h">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="acc-h" className="display text-2xl font-semibold">Estimates</h2>
                {accuracy.accuracy !== null && (
                  <span className="font-mono text-xs uppercase tracking-widest text-muted">{Math.round(accuracy.accuracy * 100)}% accurate</span>
                )}
              </div>
              {accuracy.rows.length === 0 ? (
                <p className="mt-2 text-muted">Finish tasks that have pomodoros logged against them to see how your estimates hold up.</p>
              ) : (
                <>
                  <p className="mt-1 text-muted">
                    {Math.abs(accuracy.bias!) < 0.1
                      ? 'Your estimates are close to reality.'
                      : accuracy.bias! > 0
                        ? <>Tasks take about <b className="text-fg">{Math.round(accuracy.bias! * 100)}% longer</b> than you estimate.</>
                        : <>Tasks take about <b className="text-fg">{Math.round(-accuracy.bias! * 100)}% less</b> than you estimate.</>}
                  </p>
                  <EstimateList rows={accuracy.rows.slice().sort((a, b) => (b.task.doneAt ?? 0) - (a.task.doneAt ?? 0)).slice(0, 12)} projects={projectMap} />
                </>
              )}
            </section>

            <section className="card p-5 sm:p-6">
              <YearHeatmap daily={daily} end={Math.min(Date.now(), range.to - 1)} />
            </section>

            <SessionLog sessions={inPeriod} tasks={taskMap} projects={projectMap} onEdit={(s) => setEditing(s)} onAdd={() => setEditing('new')} />
          </div>
        )}
      </main>

      {editing && (
        <SessionEditor
          record={editing === 'new' ? null : editing}
          tasks={[...tasks].sort((a, b) => b.order - a.order)}
          projects={projects.filter((p) => !p.archived)}
          onClose={() => setEditing(null)}
          onDeleted={(r) => setToast({ text: 'Session deleted.', undo: () => void restoreSession(r.id) })}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" role="status" aria-live="polite">
          <div className="pointer-events-auto rounded-xl border-2 border-line bg-surface px-4 py-3 text-sm shadow-[0_4px_0_var(--line)]">
            {toast.text}
            {toast.undo && (
              <button className="ml-3 font-semibold underline underline-offset-4" onClick={() => { toast.undo?.(); setToast(null) }}>Undo</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** When switching period, stay on today if it's in view, otherwise on the start of what's shown. */
const anchorFor = (r: Range) => (Date.now() >= r.from && Date.now() < r.to ? Date.now() : r.from)

function Tile({ k, v, sub, wide }: { k: string; v: string; sub: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`card p-4 sm:p-5 ${wide ? 'col-span-2 lg:col-span-1' : ''}`}>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{k}</div>
      <div className="numerals mt-2 text-4xl sm:text-[2.6rem]">{v}</div>
      <div className="mt-1 text-sm text-muted">{sub}</div>
    </div>
  )
}

/** Estimate vs actual per finished task: hollow ring = estimate, filled bar = actual. */
function EstimateList({ rows, projects }: { rows: { task: Task; est: number; act: number }[]; projects: Map<string, Project> }) {
  const max = Math.max(...rows.map((r) => Math.max(r.est, r.act)), 1)
  return (
    <div className="mt-4">
      <div className="mb-2 flex gap-4 font-mono text-[11px] uppercase tracking-widest text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-full bg-[var(--series-1)]" /> Actual</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full border-2 border-fg" /> Estimate</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map(({ task, est, act }) => {
          const p = task.projectId ? projects.get(task.projectId) : undefined
          return (
            <li key={task.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,16rem)_1fr_auto]">
              <span className="flex min-w-0 items-center gap-2">
                {p && <span className="size-2 shrink-0 rounded-full" style={{ background: projectColor(p.color) }} />}
                <span className="truncate">{task.title}</span>
              </span>
              <span className="relative h-3">
                <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--series-1)]" style={{ width: `${(act / max) * 100}%` }} />
                <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-surface" style={{ left: `${(est / max) * 100}%` }} />
              </span>
              <span className="font-mono text-xs tabular-nums text-muted" aria-label={`${act} actual of ${est} estimated`}>
                <span className={act > est ? 'text-[var(--series-1)]' : 'text-fg'}>{act}</span>/{est}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
