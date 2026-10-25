/**
 * Pure timer engine. All time is wall-clock (Date.now()) based: the state
 * stores when the current running segment began plus time banked from earlier
 * segments, so remaining time is always recomputed — no drift, no lost time
 * when a tab sleeps or reloads.
 */

export type Mode = 'focus' | 'short' | 'long'
export type Status = 'idle' | 'running' | 'paused'
export type Outcome = 'completed' | 'skipped' | 'abandoned'

export interface TimerSettings {
  focusMin: number
  shortMin: number
  longMin: number
  longInterval: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
}

export interface TimerState {
  v: 1
  mode: Mode
  status: Status
  plannedMs: number
  /** time banked from finished running segments */
  bankedMs: number
  /** wall-clock ms when the current running segment began */
  segmentStart: number | null
  /** id of the session in progress (stable across pauses, used for idempotent logging) */
  sessionId: string | null
  /** wall-clock ms when the session was first started */
  sessionStart: number | null
  pauses: number
  /** focus sessions completed since the last long break */
  cycle: number
  /** task being worked on; the session is credited to whatever is selected when it ends */
  taskId: string | null
  projectId: string | null
}

export interface SessionRecord {
  id: string
  mode: Mode
  status: Outcome
  plannedSec: number
  actualSec: number
  startedAt: number
  endedAt: number
  pauses: number
  taskId: string | null
  projectId: string | null
  note: string
  quality: number | null
  device: string
  createdAt: number
  revision: number
  /** soft delete; kept so sync can propagate the deletion */
  deletedAt?: number | null
  /** last edit time; sync uses it to decide which copy is newer */
  updatedAt?: number
}

/** Below this, a reset or mode switch is treated as a mis-click and not logged. */
export const MIN_LOGGED_MS = 60_000

export const plannedFor = (mode: Mode, s: TimerSettings) =>
  Math.round((mode === 'focus' ? s.focusMin : mode === 'short' ? s.shortMin : s.longMin) * 60_000)

type Task = { taskId: string | null; projectId: string | null }
const NO_TASK: Task = { taskId: null, projectId: null }

export function initialState(s: TimerSettings, mode: Mode = 'focus', cycle = 0, task: Task = NO_TASK): TimerState {
  return { v: 1, mode, status: 'idle', plannedMs: plannedFor(mode, s), bankedMs: 0, segmentStart: null, sessionId: null, sessionStart: null, pauses: 0, cycle, ...task }
}

const taskOf = (t: TimerState): Task => ({ taskId: t.taskId ?? null, projectId: t.projectId ?? null })

export function setTask(t: TimerState, task: Task): TimerState {
  return { ...t, ...task }
}

export function elapsed(t: TimerState, now: number) {
  return t.bankedMs + (t.status === 'running' && t.segmentStart !== null ? Math.max(0, now - t.segmentStart) : 0)
}

export function remaining(t: TimerState, now: number) {
  return Math.max(0, t.plannedMs - elapsed(t, now))
}

export const isDue = (t: TimerState, now: number) => t.status === 'running' && remaining(t, now) <= 0

export function start(t: TimerState, now: number, id: string): TimerState {
  if (t.status === 'running') return t
  if (t.status === 'paused') return { ...t, status: 'running', segmentStart: now }
  return { ...t, status: 'running', segmentStart: now, sessionId: id, sessionStart: now, bankedMs: 0, pauses: 0 }
}

export function pause(t: TimerState, now: number): TimerState {
  if (t.status !== 'running') return t
  return { ...t, status: 'paused', bankedMs: elapsed(t, now), segmentStart: null, pauses: t.pauses + 1 }
}

export function nextMode(t: TimerState, s: TimerSettings): { mode: Mode; cycle: number } {
  if (t.mode !== 'focus') return { mode: 'focus', cycle: t.mode === 'long' ? 0 : t.cycle }
  const cycle = t.cycle + 1
  return cycle >= Math.max(1, s.longInterval) ? { mode: 'long', cycle: 0 } : { mode: 'short', cycle }
}

function record(t: TimerState, status: Outcome, endedAt: number, actualMs: number, device: string): SessionRecord {
  return {
    id: t.sessionId!,
    mode: t.mode,
    status,
    plannedSec: Math.round(t.plannedMs / 1000),
    actualSec: Math.round(actualMs / 1000),
    startedAt: t.sessionStart!,
    endedAt,
    pauses: t.pauses,
    // breaks aren't credited to a task
    taskId: t.mode === 'focus' ? (t.taskId ?? null) : null,
    projectId: t.mode === 'focus' ? (t.projectId ?? null) : null,
    note: '',
    quality: null,
    device,
    createdAt: endedAt,
    revision: 1,
  }
}

export interface Transition {
  state: TimerState
  record: SessionRecord | null
}

/**
 * Finish the running session because its time is up.
 * `now` may be long after the due time (tab was closed); the record keeps the
 * true end time, and auto-start only chains when we finished on time.
 */
export function complete(t: TimerState, now: number, s: TimerSettings, device: string, newId: string): Transition {
  const dueAt = (t.segmentStart ?? now) + (t.plannedMs - t.bankedMs)
  const endedAt = Math.min(now, dueAt)
  const rec = record(t, 'completed', endedAt, t.plannedMs, device)
  const { mode, cycle } = nextMode(t, s)
  let state = initialState(s, mode, cycle, taskOf(t))
  const onTime = now - dueAt < 5_000
  const auto = mode === 'focus' ? s.autoStartFocus : s.autoStartBreaks
  if (auto && onTime) state = start(state, endedAt, newId)
  return { state, record: rec }
}

/** Jump to the next mode now. Logged as skipped if it ran long enough to matter. */
export function skip(t: TimerState, now: number, s: TimerSettings, device: string): Transition {
  const ms = elapsed(t, now)
  const rec = t.sessionId && ms >= MIN_LOGGED_MS ? record(t, 'skipped', now, ms, device) : null
  const { mode, cycle } = nextMode(t, s)
  return { state: initialState(s, mode, t.mode === 'focus' && !rec ? t.cycle : cycle, taskOf(t)), record: rec }
}

/** Stop and discard the current run, optionally switching mode. */
export function reset(t: TimerState, now: number, s: TimerSettings, device: string, mode: Mode = t.mode): Transition {
  const ms = elapsed(t, now)
  const rec = t.sessionId && ms >= MIN_LOGGED_MS ? record(t, 'abandoned', now, ms, device) : null
  return { state: initialState(s, mode, t.cycle, taskOf(t)), record: rec }
}

/** Apply new durations to an idle timer; a session in progress keeps its plan. */
export function applySettings(t: TimerState, s: TimerSettings): TimerState {
  return t.status === 'idle' ? { ...t, plannedMs: plannedFor(t.mode, s) } : t
}
