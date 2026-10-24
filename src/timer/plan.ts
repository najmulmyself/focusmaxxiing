import { plannedFor, remaining, type TimerSettings, type TimerState } from './engine'

export interface FinishEstimate {
  /** pomodoros still to do across unfinished tasks */
  pomos: number
  /** total time from now, including the breaks in between */
  totalMs: number
  endsAt: number
}

/**
 * When will today's list be done? Walks the remaining pomodoros forward from the
 * current timer, inserting short/long breaks exactly as the timer would.
 */
export function estimateFinish(pomos: number, t: TimerState, s: TimerSettings, now: number): FinishEstimate {
  let ms = 0
  let left = Math.max(0, pomos)
  let cycle = t.cycle
  const focusMs = plannedFor('focus', s)

  if (t.mode === 'focus' && t.status !== 'idle' && left > 0) {
    ms += remaining(t, now)
    left--
    cycle++
    if (left > 0) ms += breakAfter()
  } else if (t.mode !== 'focus') {
    if (left > 0) ms += t.status === 'idle' ? t.plannedMs : remaining(t, now)
    if (t.mode === 'long') cycle = 0
  }

  for (let i = 0; i < left; i++) {
    ms += focusMs
    cycle++
    if (i < left - 1) ms += breakAfter()
  }

  return { pomos: Math.max(0, pomos), totalMs: ms, endsAt: now + ms }

  function breakAfter() {
    if (cycle >= Math.max(1, s.longInterval)) {
      cycle = 0
      return plannedFor('long', s)
    }
    return plannedFor('short', s)
  }
}
