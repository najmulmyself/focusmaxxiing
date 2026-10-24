import { useEffect, useRef, useState } from 'react'
import { Pip, type PipMood } from '../mascot/Pip'
import { WeekChart, YearHeatmap } from './ReportPreview'

type Mode = 'focus' | 'short' | 'long'
const MODES: Record<Mode, { label: string; minutes: number }> = {
  focus: { label: 'Focus', minutes: 25 },
  short: { label: 'Short break', minutes: 5 },
  long: { label: 'Long break', minutes: 15 },
}

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`

/** A working miniature of the timer, so the tile shows how modes, type and Pip behave together. */
function TimerDemo() {
  const [mode, setMode] = useState<Mode>('focus')
  const [remaining, setRemaining] = useState(MODES.focus.minutes * 60)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [flash, setFlash] = useState<null | 'celebrate' | 'sad'>(null)
  const [done, setDone] = useState(0)
  const total = MODES[mode].minutes * 60
  const started = remaining < total

  const tick = useRef<() => void>(() => {})
  tick.current = () => {
    if (remaining > 1) return setRemaining(remaining - 1)
    setRunning(false)
    if (mode === 'focus') {
      const n = done + 1
      setDone(n)
      setFlash('celebrate')
      setTimeout(() => {
        setFlash(null)
        switchMode(n % 4 === 0 ? 'long' : 'short')
      }, 3200)
    } else switchMode('focus')
  }

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick.current(), 1000 / speed)
    return () => clearInterval(id)
  }, [running, speed])

  function switchMode(m: Mode) {
    setMode(m)
    setRemaining(MODES[m].minutes * 60)
    setRunning(false)
  }

  function reset() {
    if (mode === 'focus' && started) {
      setFlash('sad')
      setTimeout(() => setFlash(null), 2600)
    }
    switchMode(mode)
  }

  let mood: PipMood = 'idle'
  if (flash) mood = flash
  else if (mode === 'focus' && running) mood = remaining <= 60 ? 'almost' : 'focus'
  else if (mode === 'focus' && started) mood = 'paused'
  else if (mode === 'short' && started) mood = 'shortBreak'
  else if (mode === 'long' && started) mood = 'longBreak'

  return (
    <div data-mode={mode} className="card overflow-hidden transition-colors duration-700" style={{ background: 'var(--accent)' }}>
      <div className="grid items-center gap-2 p-5 text-on-accent sm:p-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="inline-flex rounded-full border-2 border-line bg-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1" role="tablist" aria-label="Timer mode">
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={m === mode}
                onClick={() => switchMode(m)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors sm:px-4 ${m === mode ? 'bg-paper text-ink' : 'text-on-accent/85 hover:text-on-accent'}`}
              >
                {MODES[m].label}
              </button>
            ))}
          </div>

          <div className="numerals mt-4 text-[min(30vw,10.5rem)] leading-[0.9] [text-shadow:0_4px_0_var(--line)]" aria-live="off">
            {fmt(remaining)}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="btn btn-ink min-w-40 px-8 py-3.5 text-lg tracking-wide" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={() => setRunning(!running)}>
              {running ? 'Pause' : started ? 'Resume' : 'Start'}
            </button>
            <button className="btn px-4 py-3.5" onClick={reset} aria-label="Reset" title="Reset (R)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4.5h4.5" /></svg>
            </button>
            <button className="btn px-4 py-3.5" onClick={() => setRemaining(1)} aria-label="Skip to end" title="Skip (S)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></svg>
            </button>
            <label className="ml-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-on-accent/80">
              <input type="checkbox" checked={speed > 1} onChange={(e) => setSpeed(e.target.checked ? 60 : 1)} className="size-4 accent-[var(--ink)]" />
              demo ×60
            </label>
          </div>

          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-on-accent/80">
            #{done + 1} · Working on <span className="text-on-accent">Write the onboarding copy</span>
          </p>
        </div>
        <div className="order-first -mb-4 flex justify-center md:order-none md:mb-0 md:justify-end">
          <Pip mood={mood} progress={mode === 'focus' ? 1 - remaining / total : 0} size="min(340px, 52vw)" dozeAfter={0} />
        </div>
      </div>
    </div>
  )
}

const SWATCHES: [string, string, string][] = [
  ['Paper', '#F4EFE6', 'Base surface. Never pure white.'],
  ['Ink', '#1D1B18', 'Text, outlines, hard shadows.'],
  ['Vermilion', '#E4572E', 'Focus. The only loud colour.'],
  ['Sage', '#7FA38A', 'Short break.'],
  ['Dusk', '#3E5C76', 'Long break.'],
  ['Charcoal', '#1F1D1A', 'Dark mode base. Warm, not black.'],
]

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-24">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{kicker}</p>
      <h2 className="display mt-1 text-4xl font-semibold sm:text-5xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  )
}

function TaskRow({ title, done, est, act, project, color, active }: { title: string; done?: boolean; est: number; act: number; project: string; color: string; active?: boolean }) {
  return (
    <li className={`flex items-center gap-3 rounded-xl border-2 border-line bg-surface px-3 py-3 sm:px-4 ${active ? 'shadow-[inset_6px_0_0_var(--vermilion)]' : ''}`}>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full border-2 border-line ${done ? 'bg-ink text-paper' : ''}`}>
        {done && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.2 2.2L9.5 3.5" /></svg>}
      </span>
      <span className={`min-w-0 flex-1 truncate font-medium ${done ? 'text-faint line-through' : ''}`}>{title}</span>
      <span className="hidden items-center gap-1.5 rounded-full border-2 border-line px-2 py-0.5 text-xs font-semibold sm:inline-flex">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {project}
      </span>
      <span className="font-mono text-sm tabular-nums text-muted">
        <span className="text-fg">{act}</span>/{est}
      </span>
    </li>
  )
}

export function StyleTile() {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const toggleTheme = () => {
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'
    setDark(!dark)
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-12 pb-10 sm:pt-16">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Style tile · milestone 1</p>
          <h1 className="display mt-2 max-w-3xl text-5xl leading-[0.95] font-semibold sm:text-7xl">
            A kitchen timer <em className="font-normal">with a pulse.</em>
          </h1>
        </div>
        <button className="btn px-4 py-2 text-sm" onClick={toggleTheme} aria-pressed={dark}>
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      <TimerDemo />

      <Section kicker="01" title="Colour">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map(([name, hex, note]) => (
            <div key={name} className="card overflow-hidden">
              <div className="h-24 border-b-2 border-line" style={{ background: hex }} />
              <div className="p-3">
                <div className="font-semibold">{name}</div>
                <code className="font-mono text-xs text-muted">{hex}</code>
                <p className="mt-1 text-xs leading-snug text-muted">{note}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-2xl text-muted">
          The page is paper and ink. During a session the whole background floods with the mode colour, so you can tell
          what you&rsquo;re doing from across the room. Chart colours are a separate, colour-blind-checked set.
        </p>
      </Section>

      <Section kicker="02" title="Type">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          <div className="card p-6 sm:p-8">
            <div className="numerals text-[min(26vw,9rem)] leading-none">24:59</div>
            <p className="mt-4 font-mono text-xs uppercase tracking-widest text-muted">Fraunces · soft, tabular numerals · 600</p>
          </div>
          <div className="card flex flex-col justify-between gap-6 p-6 sm:p-8">
            <div>
              <div className="display text-4xl font-semibold">Stay with it.</div>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">Fraunces · display</p>
            </div>
            <div>
              <p className="text-lg">Instrument Sans carries the interface — task names, settings, everything you read at a glance.</p>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">Instrument Sans · UI</p>
            </div>
            <div>
              <p className="font-mono text-sm">4 POMODOROS · 1H 40M · FINISH AT 17:20</p>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">JetBrains Mono · data &amp; labels</p>
            </div>
          </div>
        </div>
      </Section>

      <Section kicker="03" title="Pieces">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
          <div className="card flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex flex-wrap gap-3">
              <button className="btn btn-accent px-5 py-2.5">Start focus</button>
              <button className="btn px-5 py-2.5">Add task</button>
              <button className="btn btn-ink px-5 py-2.5">Export CSV</button>
            </div>
            <p className="text-sm text-muted">Sticker buttons: ink outline, hard shadow. Pressing pushes them flat — it should feel like a real key.</p>
            <label className="block">
              <span className="text-sm font-semibold">What are you working on?</span>
              <input className="mt-2 w-full rounded-xl border-2 border-line bg-surface px-4 py-3 outline-none placeholder:text-faint focus:shadow-[0_0_0_3px_var(--vermilion)]" placeholder="e.g. Draft the quarterly review" />
            </label>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-semibold">Auto-start breaks</span>
              <Toggle />
            </div>
          </div>
          <div className="card p-6 sm:p-8">
            <div className="flex items-baseline justify-between">
              <h3 className="display text-2xl font-semibold">Today</h3>
              <span className="font-mono text-xs uppercase tracking-widest text-muted">Finish at 17:20</span>
            </div>
            <ul className="mt-4 flex flex-col gap-2">
              <TaskRow title="Write the onboarding copy" est={4} act={2} project="Writing" color="var(--series-3)" active />
              <TaskRow title="Review sync-engine PR" est={2} act={0} project="Deep work" color="var(--series-1)" />
              <TaskRow title="Linear algebra ch. 4" est={3} act={3} project="Study" color="var(--series-2)" done />
              <TaskRow title="Inbox to zero" est={1} act={1} project="Admin" color="var(--series-4)" done />
            </ul>
            <button className="mt-3 w-full rounded-xl border-2 border-dashed border-line/50 py-3 text-sm font-semibold text-muted hover:border-line hover:text-fg">+ Add task</button>
          </div>
        </div>
      </Section>

      <Section kicker="04" title="Reports">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['Focus this week', '14h 20m', '+2h 05m vs last week'],
            ['Streak', '9 days', 'Longest: 23'],
            ['Estimate accuracy', '82%', 'You under-estimate writing'],
            ['Best hours', '9–11 am', '41% of deep work'],
          ].map(([k, v, sub]) => (
            <div key={k} className="card p-4 sm:p-5">
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{k}</div>
              <div className="numerals mt-2 text-4xl sm:text-5xl">{v}</div>
              <div className="mt-1 text-sm text-muted">{sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.25fr] [&>*]:min-w-0">
          <div className="card p-5 sm:p-6">
            <WeekChart />
          </div>
          <div className="card p-5 sm:p-6">
            <YearHeatmap />
          </div>
        </div>
      </Section>
    </main>
  )
}

function Toggle() {
  const [on, setOn] = useState(true)
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => setOn(!on)}
      className={`relative h-8 w-14 rounded-full border-2 border-line transition-colors ${on ? 'bg-[var(--vermilion)]' : 'bg-[var(--paper-2)]'}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full border-2 border-line bg-paper transition-[left] duration-200 ease-[cubic-bezier(.3,.7,.4,1.4)] ${on ? 'left-[26px]' : 'left-0.5'}`} />
    </button>
  )
}
