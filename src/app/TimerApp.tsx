import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pip, type PipMood } from '../mascot/Pip'
import { playAlarm, setAmbient, unlockAudio } from '../audio/sound'
import { MIN_LOGGED_MS, elapsed, type Mode, type SessionRecord } from '../timer/engine'
import { useSettings } from '../timer/useSettings'
import { useTimer, type TimerApi, type TimerEvent } from '../timer/useTimer'
import type { Settings } from '../timer/settings'
import { Modal } from './Modal'
import { SettingsDialog } from './SettingsDialog'
import { MODE_LABEL, fmtClock, useTabSignals } from './signals'
import { usePip } from './usePip'
import { useShortcuts, type Shortcut } from './useShortcuts'
import { useToday } from './useToday'
import { TasksPanel } from './tasks/TasksPanel'
import { Reflection } from './tasks/Reflection'
import { db } from '../data/db'
import { useLive } from '../data/useLive'
import type { Task } from '../data/model'
import { lastBackupAt } from '../data/backup'
import { IconChart, IconKeys, IconPause, IconPip, IconPlay, IconReset, IconSettings, IconSkip, IconSound } from './icons'

const MODES: Mode[] = ['focus', 'short', 'long']

type Flash = { mood: 'celebrate' | 'sad'; until: number } | null
type Toast = { id: number; text: string; undo?: () => void }

function pipMood(t: TimerApi, flash: Flash): PipMood {
  if (flash && Date.now() < flash.until) return flash.mood
  const { mode, status } = t.state
  if (status === 'idle') return 'idle'
  if (mode === 'focus') return status === 'paused' ? 'paused' : t.remainingMs <= 60_000 ? 'almost' : 'focus'
  return mode === 'short' ? 'shortBreak' : 'longBreak'
}

function notify(title: string, body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'focusmaxxiing', silent: true })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

function completionCopy(rec: SessionRecord, s: Settings): [string, string] {
  if (rec.mode === 'focus') return ['Focus done', `${Math.round(rec.actualSec / 60)} minutes in the bank. Time for a ${s.shortMin}-minute break.`]
  return ['Break over', 'Ready when you are. Pip is warming up the anvil.']
}

export function TimerApp() {
  const [settings, update] = useSettings()
  const [flash, setFlash] = useState<Flash>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<null | 'settings' | 'keys' | { confirm: Mode | 'reset' }>(null)
  const [muted, setMuted] = useState(false)

  const [reflect, setReflect] = useState<SessionRecord | null>(null)

  const toast = (text: string, undo?: () => void) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, undo }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 8000 : 6000)
  }
  const dismissToast = (id: number) => setToasts((t) => t.filter((x) => x.id !== id))
  const cheer = () => setFlash({ mood: 'celebrate', until: Date.now() + 1800 })

  const onEvent = (e: TimerEvent, leader: boolean) => {
    if (e.kind === 'completed' && e.record) {
      if (e.record.mode === 'focus') setFlash({ mood: 'celebrate', until: Date.now() + 3600 })
      if (e.record.mode === 'focus' && !e.away) setReflect(e.record)
      if (e.away) {
        toast(`Your ${Math.round(e.record.actualSec / 60)}-minute ${MODE_LABEL[e.record.mode].toLowerCase()} finished while you were away. It's logged.`)
        return
      }
      if (!leader) return
      playAlarm(settings.alarm, settings.alarmVolume, settings.alarmRepeat)
      if (settings.notifications && document.hidden) notify(...completionCopy(e.record, settings))
    } else if (e.kind === 'abandoned' && e.record?.mode === 'focus') {
      setFlash({ mood: 'sad', until: Date.now() + 2800 })
      toast(`Logged ${Math.round(e.record.actualSec / 60)} minutes as an unfinished focus.`)
    }
  }

  const t = useTimer(settings, onEvent)
  const { mode, status } = t.state
  const today = useToday()
  const focusDone = today?.filter((s) => s.mode === 'focus' && s.status === 'completed').length ?? 0
  const activeTask = useLive(() => (t.state.taskId ? db.tasks.get(t.state.taskId) : Promise.resolve(undefined)), [t.state.taskId], undefined as Task | undefined)

  // the reflection card goes away once the next focus session starts
  useEffect(() => {
    if (reflect && mode === 'focus' && status === 'running') setReflect(null)
  }, [reflect, mode, status])

  useEffect(() => {
    document.documentElement.dataset.mode = mode
    return () => {
      delete document.documentElement.dataset.mode
    }
  }, [mode])

  // flash moods expire on their own
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), Math.max(0, flash.until - Date.now()))
    return () => clearTimeout(id)
  }, [flash])

  // ambient sound plays only while focusing
  const focusing = mode === 'focus' && status === 'running'
  useEffect(() => {
    setAmbient(focusing && !muted ? settings.ambient : 'none', settings.ambientVolume)
  }, [focusing, muted, settings.ambient, settings.ambientVolume])
  useEffect(() => () => setAmbient('none', 0), [])

  useTabSignals(mode, status, t.remainingMs, t.progress)
  const pip = usePip({ mode, theme: document.documentElement.dataset.theme })

  const needsConfirm = () => t.state.mode === 'focus' && t.state.status !== 'idle' && elapsed(t.state, Date.now()) >= MIN_LOGGED_MS
  const act = {
    toggle: () => {
      unlockAudio()
      t.toggle()
    },
    reset: () => (needsConfirm() ? setDialog({ confirm: 'reset' }) : t.reset()),
    skip: () => t.skip(),
    mode: (m: Mode) => {
      if (m === mode) return
      if (needsConfirm()) setDialog({ confirm: m })
      else t.switchMode(m)
    },
  }

  const shortcuts: Shortcut[] = [
    { keys: ['Space'], label: 'Start / pause', run: act.toggle },
    { keys: ['r'], label: 'Reset', run: act.reset },
    { keys: ['s'], label: 'Skip to next', run: act.skip },
    { keys: ['1'], label: 'Focus', run: () => act.mode('focus') },
    { keys: ['2'], label: 'Short break', run: () => act.mode('short') },
    { keys: ['3'], label: 'Long break', run: () => act.mode('long') },
    ...(pip.supported ? [{ keys: ['p'], label: 'Pop-out timer', run: () => (pip.win ? pip.close() : void pip.open()) }] : []),
    { keys: ['m'], label: 'Mute ambient sound', run: () => setMuted((m) => !m) },
    { keys: [','], label: 'Settings', run: () => setDialog('settings') },
    { keys: ['?', '/'], label: 'Keyboard shortcuts', run: () => setDialog('keys') },
  ]
  useShortcuts(shortcuts, dialog === null, [pip.win])

  const mood = pipMood(t, flash)
  const statusLine =
    mode === 'focus'
      ? `#${focusDone + 1} · ${activeTask && !activeTask.deletedAt ? activeTask.title : status === 'idle' ? 'Time to focus' : status === 'paused' ? 'Paused' : 'Focusing'}`
      : mode === 'short' ? 'Short break · stretch, sip, breathe' : 'Long break · you earned it'

  return (
    <div className="grain flex min-h-dvh flex-col bg-stage text-stage-ink transition-colors duration-700">
      {/* progress along the very top */}
      <div className="h-1 w-full bg-[color-mix(in_oklab,var(--ink)_22%,transparent)]" aria-hidden>
        <div className="h-full bg-[var(--stage-ink)] transition-[width] duration-300 ease-linear" style={{ width: `${Math.min(100, t.progress * 100)}%` }} />
      </div>

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-8">
        <a href="#/" className="display text-xl font-semibold tracking-tight">
          focusmaxxiing<span className="opacity-60">.</span>
        </a>
        <div className="flex items-center gap-2">
          {settings.ambient !== 'none' && (
            <button className="btn size-10" onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={muted ? 'Unmute ambient sound' : 'Mute ambient sound'} title="Mute ambient (M)">
              <IconSound muted={muted} />
            </button>
          )}
          {pip.supported && (
            <button className="btn size-10" onClick={() => (pip.win ? pip.close() : void pip.open())} aria-pressed={!!pip.win} aria-label="Pop-out timer" title="Pop-out timer (P)">
              <IconPip />
            </button>
          )}
          <a className="btn h-10 gap-2 px-3 text-sm" href="#/reports" title="Reports">
            <IconChart />
            <span className="hidden sm:inline">Reports</span>
          </a>
          <button className="btn hidden size-10 sm:inline-flex" onClick={() => setDialog('keys')} aria-label="Keyboard shortcuts" title="Shortcuts (?)">
            <IconKeys />
          </button>
          <button className="btn size-10" onClick={() => setDialog('settings')} aria-label="Settings" title="Settings (,)">
            <IconSettings />
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-center items-center gap-2 px-4 pt-4 pb-10 sm:px-8 md:grid-cols-[1.15fr_1fr] md:pt-10">
        <div className="order-first -mb-6 flex justify-center md:order-last md:mb-0">
          <Pip mood={mood} progress={mode === 'focus' ? t.progress : 0} size="min(360px, 58vw)" dozeAfter={status === 'idle' ? 120 : 0} />
        </div>
        <section aria-label="Timer" className="flex flex-col items-center md:items-start">
          <div className="inline-flex rounded-full border-2 border-line bg-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1" role="tablist" aria-label="Timer mode">
            {MODES.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={m === mode}
                onClick={() => act.mode(m)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors sm:px-4 ${m === mode ? 'bg-paper text-ink' : 'opacity-85 hover:opacity-100'}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <div role="timer" aria-label={`${MODE_LABEL[mode]} ${fmtClock(t.remainingMs)} remaining`} className="numerals mt-3 text-[min(27vw,10.5rem)] leading-[0.9] [text-shadow:0_4px_0_var(--line)]">
            {fmtClock(t.remainingMs)}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button className="btn min-w-44 gap-2.5 px-8 py-4 text-lg tracking-wide" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={act.toggle}>
              {status === 'running' ? <IconPause /> : <IconPlay />}
              {status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
            </button>
            <button className="btn size-14" onClick={act.reset} aria-label="Reset" title="Reset (R)" disabled={status === 'idle'}>
              <IconReset />
            </button>
            <button className="btn size-14" onClick={act.skip} aria-label="Skip to next" title="Skip (S)">
              <IconSkip />
            </button>
          </div>

          <p className="mt-6 max-w-full truncate font-mono text-xs uppercase tracking-[0.18em] opacity-85">{statusLine}</p>

          {reflect && <Reflection record={reflect} task={activeTask && activeTask.id === reflect.taskId ? activeTask : null} onClose={() => setReflect(null)} onTaskDone={cheer} />}
        </section>
      </main>

      <div className="mx-auto grid w-full max-w-5xl items-start gap-4 px-4 pb-8 sm:px-8 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <TasksPanel t={t} settings={settings} onToast={toast} onTaskDone={cheer} />
        <TodayPanel sessions={today} />
      </div>

      <footer className="mx-auto flex w-full max-w-5xl justify-between gap-4 px-4 pb-6 font-mono text-[11px] uppercase tracking-widest opacity-70 sm:px-8">
        <BackupNote sessions={today?.length ?? 0} onOpen={() => setDialog('settings')} />
        <span className="flex gap-4">
          <a href="#/style" className="hover:underline">Style tile</a>
          <a href="#/mascot" className="hover:underline">Meet Pip</a>
        </span>
      </footer>

      <Toasts toasts={toasts} onDismiss={dismissToast} />

      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} settings={settings} update={update} focusing={focusing} />

      <Modal open={dialog === 'keys'} onClose={() => setDialog(null)} title="Shortcuts" width="max-w-sm">
        <ul className="flex flex-col gap-2">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4">
              <span>{s.label}</span>
              <kbd className="min-w-10 rounded-lg border-2 border-line px-2 py-0.5 text-center font-mono text-sm shadow-[0_2px_0_var(--line)]">{s.keys[0] === 'Space' ? 'Space' : s.keys[0].toUpperCase()}</kbd>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={typeof dialog === 'object' && dialog !== null} onClose={() => setDialog(null)} title="End this focus?" width="max-w-md">
        <p className="text-muted">
          You&rsquo;re {Math.floor(elapsed(t.state, t.now) / 60_000)} minutes in. Ending now logs it as an unfinished focus session.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button className="btn px-5 py-2.5" onClick={() => setDialog(null)} autoFocus>
            Keep going
          </button>
          <button
            className="btn btn-accent px-5 py-2.5"
            data-mode="focus"
            onClick={() => {
              const d = dialog
              setDialog(null)
              if (typeof d === 'object' && d) d.confirm === 'reset' ? t.reset() : t.switchMode(d.confirm)
            }}
          >
            End session
          </button>
        </div>
      </Modal>

      {pip.win &&
        createPortal(<MiniTimer t={t} mood={mood} onToggle={act.toggle} onSkip={act.skip} />, pip.win.document.body)}
    </div>
  )
}

function MiniTimer({ t, mood, onToggle, onSkip }: { t: TimerApi; mood: PipMood; onToggle: () => void; onSkip: () => void }) {
  const { mode, status } = t.state
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-1 bg-stage p-3 text-stage-ink">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] opacity-85">{MODE_LABEL[mode]}</div>
      <div className="numerals text-[min(26vw,4.6rem)] leading-none [text-shadow:0_3px_0_var(--line)]">{fmtClock(t.remainingMs)}</div>
      <Pip mood={mood} progress={mode === 'focus' ? t.progress : 0} size="min(150px, 42vh)" interactive={false} dozeAfter={0} />
      <div className="flex gap-2">
        <button className="btn gap-2 px-5 py-2" style={{ background: 'var(--paper)', color: 'var(--ink)' }} onClick={onToggle}>
          {status === 'running' ? <IconPause /> : <IconPlay />}
          {status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
        </button>
        <button className="btn size-10" onClick={onSkip} aria-label="Skip to next">
          <IconSkip />
        </button>
      </div>
    </div>
  )
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function TodayPanel({ sessions }: { sessions: SessionRecord[] | null }) {
  const taskIds = [...new Set(sessions?.map((s) => s.taskId).filter((x): x is string => !!x) ?? [])].join(',')
  const tasks = useLive(() => (taskIds ? db.tasks.bulkGet(taskIds.split(',')) : Promise.resolve([])), [taskIds], [] as (Task | undefined)[])
  const names = new Map(tasks.filter((x): x is Task => !!x).map((x) => [x.id, x.title]))
  const focus = sessions?.filter((s) => s.mode === 'focus') ?? []
  const focusMin = Math.round(focus.reduce((a, s) => a + s.actualSec, 0) / 60)
  const done = focus.filter((s) => s.status === 'completed').length
  return (
    <section aria-labelledby="today-h" className="card p-5 text-fg sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="today-h" className="display text-2xl font-semibold">Today</h2>
          <div className="flex gap-5 font-mono text-xs uppercase tracking-widest text-muted">
            <span><b className="numerals text-2xl text-fg normal-case">{done}</b> pomodoros</span>
            <span><b className="numerals text-2xl text-fg normal-case">{focusMin >= 60 ? `${Math.floor(focusMin / 60)}h ${focusMin % 60}m` : `${focusMin}m`}</b> focused</span>
          </div>
        </div>
        {sessions === null ? null : sessions.length === 0 ? (
          <p className="mt-3 text-muted">Nothing logged yet today. Press Start, or hit Space.</p>
        ) : (
          <ol className="mt-4 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
            {[...sessions].reverse().map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm">
                <span
                  className="size-3 shrink-0 rounded-full border-2 border-line"
                  style={{ background: s.mode === 'focus' ? 'var(--vermilion)' : s.mode === 'short' ? 'var(--sage)' : 'var(--dusk)' }}
                  aria-hidden
                />
                <span className="w-32 shrink-0 font-mono text-xs tabular-nums text-muted">
                  {fmtTime(s.startedAt)}–{fmtTime(s.endedAt)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium" title={s.note || undefined}>
                  {s.taskId && names.has(s.taskId) ? names.get(s.taskId) : MODE_LABEL[s.mode]}
                  {s.note && <span className="ml-2 font-normal text-muted">— {s.note}</span>}
                </span>
                <span className="font-mono text-xs tabular-nums">{Math.round(s.actualSec / 60)}m</span>
                {s.status !== 'completed' && (
                  <span className="rounded-full border-2 border-line/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">{s.status === 'skipped' ? 'skipped' : 'unfinished'}</span>
                )}
              </li>
            ))}
          </ol>
        )}
    </section>
  )
}

function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto max-w-md rounded-xl border-2 border-line bg-surface px-4 py-3 text-sm text-fg shadow-[0_4px_0_var(--line)]">
          {t.text}
          {t.undo && (
            <button
              className="ml-3 font-semibold underline underline-offset-4"
              onClick={() => {
                t.undo?.()
                onDismiss(t.id)
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Quiet reminder in the footer: everything is local until you back it up (sync arrives in milestone 6). */
function BackupNote({ sessions, onOpen }: { sessions: number; onOpen: () => void }) {
  const last = lastBackupAt()
  const days = last ? Math.floor((Date.now() - last) / 86_400_000) : null
  const stale = days === null ? sessions > 0 : days >= 7
  return (
    <span>
      Saved on this device
      {stale && (
        <>
          {' · '}
          <button className="underline underline-offset-4 hover:opacity-100" onClick={onOpen}>
            {days === null ? 'Back up your data' : `Last backup ${days} days ago`}
          </button>
        </>
      )}
    </span>
  )
}
