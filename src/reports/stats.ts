import type { SessionRecord } from '../timer/engine'
import type { Task } from '../data/model'

/* All report maths lives here as pure functions over the session log. */

export type Period = 'day' | 'week' | 'month' | 'year' | 'custom'

export interface Range {
  period: Period
  from: number
  /** exclusive */
  to: number
}

export interface Bucket {
  key: string
  /** axis label */
  label: string
  /** tooltip / table label */
  long: string
  from: number
  to: number
}

const DAY = 86_400_000

export const startOfDay = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
export const addDays = (ms: number, n: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Monday-based week start */
export const startOfWeek = (ms: number) => {
  const d = new Date(startOfDay(ms))
  return addDays(d.getTime(), -((d.getDay() + 6) % 7))
}

export function periodRange(period: Exclude<Period, 'custom'>, anchor: number): Range {
  const d = new Date(anchor)
  switch (period) {
    case 'day':
      return { period, from: startOfDay(anchor), to: addDays(anchor, 1) }
    case 'week': {
      const from = startOfWeek(anchor)
      return { period, from, to: addDays(from, 7) }
    }
    case 'month':
      return { period, from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() }
    case 'year':
      return { period, from: new Date(d.getFullYear(), 0, 1).getTime(), to: new Date(d.getFullYear() + 1, 0, 1).getTime() }
  }
}

export function customRange(fromDay: number, toDayInclusive: number): Range {
  const a = startOfDay(Math.min(fromDay, toDayInclusive))
  const b = addDays(Math.max(fromDay, toDayInclusive), 1)
  return { period: 'custom', from: a, to: b }
}

/** The same-sized range before (-1) or after (+1). */
export function shiftRange(r: Range, dir: 1 | -1): Range {
  if (r.period === 'custom') {
    const days = Math.round((r.to - r.from) / DAY)
    return { period: 'custom', from: addDays(r.from, dir * days), to: addDays(r.to, dir * days) }
  }
  const d = new Date(r.from)
  const anchor =
    r.period === 'day' ? addDays(r.from, dir) :
    r.period === 'week' ? addDays(r.from, 7 * dir) :
    r.period === 'month' ? new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime() :
    new Date(d.getFullYear() + dir, 0, 1).getTime()
  return periodRange(r.period, anchor)
}

const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en', o)

export function rangeLabel(r: Range): string {
  const last = addDays(r.to, -1)
  switch (r.period) {
    case 'day':
      return fmt(r.from, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    case 'month':
      return fmt(r.from, { month: 'long', year: 'numeric' })
    case 'year':
      return String(new Date(r.from).getFullYear())
    default: {
      const a = new Date(r.from)
      const b = new Date(last)
      const mon = (d: Date) => d.toLocaleDateString('en', { month: 'short' })
      if (a.getFullYear() !== b.getFullYear()) return `${mon(a)} ${a.getDate()}, ${a.getFullYear()} – ${mon(b)} ${b.getDate()}, ${b.getFullYear()}`
      if (a.getMonth() !== b.getMonth()) return `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}, ${b.getFullYear()}`
      return `${mon(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
    }
  }
}

/** Chart granularity: hours for a day, months for a year or a long custom range, otherwise days. */
export function bucketUnit(r: Range): 'hour' | 'day' | 'month' {
  if (r.period === 'day') return 'hour'
  return r.period === 'year' || Math.round((r.to - r.from) / DAY) > 92 ? 'month' : 'day'
}

export function bucketsFor(r: Range): Bucket[] {
  const out: Bucket[] = []
  const days = Math.round((r.to - r.from) / DAY)
  const unit = bucketUnit(r)
  if (unit === 'hour') {
    for (let h = 0; h < 24; h++) {
      const from = r.from + h * 3_600_000
      out.push({ key: `h${h}`, label: h % 6 === 0 ? `${h}h` : '', long: new Date(from).toLocaleTimeString('en', { hour: 'numeric' }), from, to: from + 3_600_000 })
    }
  } else if (unit === 'month') {
    let d = new Date(r.from)
    d = new Date(d.getFullYear(), d.getMonth(), 1)
    while (d.getTime() < r.to) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: fmt(d.getTime(), { month: 'narrow' }), long: fmt(d.getTime(), { month: 'long', year: 'numeric' }), from: Math.max(d.getTime(), r.from), to: Math.min(next.getTime(), r.to) })
      d = next
    }
  } else {
    for (let t = r.from; t < r.to; t = addDays(t, 1)) {
      const date = new Date(t)
      const label = days <= 7 ? fmt(t, { weekday: 'short' }) : date.getDate() === 1 || date.getDate() % 5 === 0 ? String(date.getDate()) : ''
      out.push({ key: dayKey(t), label, long: fmt(t, { weekday: 'short', month: 'short', day: 'numeric' }), from: t, to: addDays(t, 1) })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */

export const isFocus = (s: SessionRecord) => s.mode === 'focus' && !s.deletedAt
const end = (s: SessionRecord) => Math.max(s.endedAt, s.startedAt + 1)

/**
 * Seconds of a session that fall inside [from, to). Sessions with pauses span
 * more wall time than they were focused, so focus is spread evenly across the span.
 */
export function secondsWithin(s: SessionRecord, from: number, to: number): number {
  const a = Math.max(s.startedAt, from)
  const b = Math.min(end(s), to)
  if (b <= a) return 0
  return (s.actualSec * (b - a)) / (end(s) - s.startedAt)
}

export const inRange = (s: SessionRecord, r: { from: number; to: number }) => s.startedAt < r.to && end(s) > r.from

/** Focus seconds per bucket, split by key (usually project id; '' for none). */
export function focusByBucket(sessions: SessionRecord[], buckets: Bucket[], keyOf: (s: SessionRecord) => string): Map<string, number>[] {
  const out = buckets.map(() => new Map<string, number>())
  for (const s of sessions) {
    if (!isFocus(s)) continue
    const k = keyOf(s)
    buckets.forEach((b, i) => {
      const sec = secondsWithin(s, b.from, b.to)
      if (sec > 0) out[i].set(k, (out[i].get(k) ?? 0) + sec)
    })
  }
  return out
}

export interface Totals {
  focusSec: number
  pomodoros: number
  focusSessions: number
  abandoned: number
  skipped: number
  /** completed ÷ all focus sessions started */
  completionRate: number | null
  avgQuality: number | null
  rated: number
  activeDays: number
  breakSec: number
}

export function totals(sessions: SessionRecord[], r: { from: number; to: number }): Totals {
  let focusSec = 0, breakSec = 0, pomodoros = 0, focusSessions = 0, abandoned = 0, skipped = 0, qSum = 0, rated = 0
  const days = new Set<string>()
  for (const s of sessions) {
    if (s.deletedAt || !inRange(s, r)) continue
    const sec = secondsWithin(s, r.from, r.to)
    if (s.mode !== 'focus') {
      breakSec += sec
      continue
    }
    focusSec += sec
    days.add(dayKey(Math.max(s.startedAt, r.from)))
    focusSessions++
    if (s.status === 'completed') pomodoros++
    else if (s.status === 'abandoned') abandoned++
    else skipped++
    if (s.quality) {
      qSum += s.quality
      rated++
    }
  }
  return {
    focusSec, breakSec, pomodoros, focusSessions, abandoned, skipped,
    completionRate: focusSessions ? pomodoros / focusSessions : null,
    avgQuality: rated ? qSum / rated : null,
    rated,
    activeDays: days.size,
  }
}

/** Focus seconds per local day (for the heatmap). */
export function dailyFocus(sessions: SessionRecord[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) {
    if (!isFocus(s)) continue
    // walk the days the session touches (almost always one)
    for (let d = startOfDay(s.startedAt); d < end(s); d = addDays(d, 1)) {
      const sec = secondsWithin(s, d, addDays(d, 1))
      if (sec > 0) m.set(dayKey(d), (m.get(dayKey(d)) ?? 0) + sec)
    }
  }
  return m
}

/** A day counts toward a streak when it has at least one completed pomodoro. Today may still be in progress. */
export function streaks(sessions: SessionRecord[], now: number): { current: number; longest: number } {
  const days = new Set(sessions.filter((s) => isFocus(s) && s.status === 'completed').map((s) => dayKey(s.startedAt)))
  if (!days.size) return { current: 0, longest: 0 }
  const sorted = [...days].sort()
  let longest = 1, run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T12:00')
    const cur = new Date(sorted[i] + 'T12:00')
    run = dayKey(addDays(prev.getTime(), 1)) === dayKey(cur.getTime()) ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  let current = 0
  let d = days.has(dayKey(now)) ? startOfDay(now) : addDays(now, -1)
  while (days.has(dayKey(d))) {
    current++
    d = addDays(d, -1)
  }
  return { current, longest }
}

/** Focus seconds by hour of day (0–23), split exactly across hour boundaries. */
export function hourProfile(sessions: SessionRecord[], r: { from: number; to: number }): number[] {
  const out = new Array<number>(24).fill(0)
  for (const s of sessions) {
    if (!isFocus(s) || !inRange(s, r)) continue
    const a = Math.max(s.startedAt, r.from)
    const b = Math.min(end(s), r.to)
    let t = a
    while (t < b) {
      const d = new Date(t)
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
      const stop = Math.min(nextHour, b)
      out[d.getHours()] += secondsWithin(s, t, stop)
      t = stop
    }
  }
  return out
}

/** Contiguous window of `width` hours holding the most focus. */
export function bestWindow(profile: number[], width = 2): { start: number; share: number } | null {
  const total = profile.reduce((a, b) => a + b, 0)
  if (!total) return null
  let best = 0, start = 0
  for (let h = 0; h <= 24 - width; h++) {
    const sum = profile.slice(h, h + width).reduce((a, b) => a + b, 0)
    if (sum > best) {
      best = sum
      start = h
    }
  }
  return { start, share: best / total }
}

export interface EstimateRow {
  task: Task
  est: number
  act: number
}

/**
 * How well finished tasks matched their estimates. Accuracy is 1 − |act − est| / est per task
 * (floored at 0), averaged. Bias > 0 means tasks took more pomodoros than estimated.
 */
export function estimateAccuracy(tasks: Task[], counts: Map<string, number>, r: { from: number; to: number }) {
  const rows: EstimateRow[] = tasks
    // cleared (soft-deleted) tasks still count: clearing a finished list shouldn't erase its history
    .filter((t) => t.done && t.doneAt !== null && t.doneAt >= r.from && t.doneAt < r.to)
    .map((t) => ({ task: t, est: t.est, act: counts.get(t.id) ?? 0 }))
    .filter((x) => x.act > 0)
  if (!rows.length) return { rows, accuracy: null, bias: null }
  const accuracy = rows.reduce((a, x) => a + Math.max(0, 1 - Math.abs(x.act - x.est) / x.est), 0) / rows.length
  const bias = rows.reduce((a, x) => a + (x.act - x.est) / x.est, 0) / rows.length
  return { rows, accuracy, bias }
}

export function byProject(sessions: SessionRecord[], r: { from: number; to: number }): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) {
    if (!isFocus(s) || !inRange(s, r)) continue
    const k = s.projectId ?? ''
    m.set(k, (m.get(k) ?? 0) + secondsWithin(s, r.from, r.to))
  }
  return m
}

export const fmtDuration = (sec: number) => {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  // past 100 hours the minutes are noise
  if (h >= 100) return `${Math.round(m / 60)}h`
  return `${h}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`
}
