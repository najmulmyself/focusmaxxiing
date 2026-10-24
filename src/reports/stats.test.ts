import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../timer/engine'
import type { Task } from '../data/model'
import {
  bestWindow, bucketsFor, customRange, dailyFocus, estimateAccuracy, focusByBucket, hourProfile,
  periodRange, rangeLabel, secondsWithin, shiftRange, streaks, totals,
} from './stats'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
let n = 0
function s(start: number, minutes: number, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `s${n++}`, mode: 'focus', status: 'completed', plannedSec: 1500, actualSec: minutes * 60,
    startedAt: start, endedAt: start + minutes * 60_000, pauses: 0, taskId: null, projectId: null,
    note: '', quality: null, device: 't', createdAt: start, revision: 1, ...extra,
  }
}

describe('ranges', () => {
  it('weeks start on Monday', () => {
    const r = periodRange('week', at(2026, 10, 24, 15)) // Saturday
    expect(new Date(r.from).getDay()).toBe(1)
    expect(r.from).toBe(at(2026, 10, 19))
    expect(r.to).toBe(at(2026, 10, 26))
  })
  it('shifts months and labels them', () => {
    const r = shiftRange(periodRange('month', at(2026, 1, 15)), -1)
    expect(r.from).toBe(at(2025, 12, 1))
    expect(rangeLabel(r)).toBe('December 2025')
  })
  it('labels week and cross-month ranges', () => {
    expect(rangeLabel(periodRange('week', at(2026, 10, 24)))).toBe('Oct 19 – 25, 2026')
    expect(rangeLabel(periodRange('week', at(2026, 11, 1)))).toBe('Oct 26 – Nov 1, 2026')
    expect(rangeLabel(customRange(at(2025, 12, 20), at(2026, 1, 3)))).toBe('Dec 20, 2025 – Jan 3, 2026')
  })
  it('custom ranges are inclusive and shift by their length', () => {
    const r = customRange(at(2026, 10, 1), at(2026, 10, 10))
    expect(r.to).toBe(at(2026, 10, 11))
    expect(shiftRange(r, 1).from).toBe(at(2026, 10, 11))
  })
  it('buckets by hour, day or month', () => {
    expect(bucketsFor(periodRange('day', at(2026, 10, 24)))).toHaveLength(24)
    expect(bucketsFor(periodRange('month', at(2026, 2, 3)))).toHaveLength(28)
    expect(bucketsFor(periodRange('year', at(2026, 2, 3)))).toHaveLength(12)
  })
})

describe('session maths', () => {
  it('spreads paused sessions across their wall-clock span', () => {
    // 25 focused minutes across a 50 minute span
    const x = s(at(2026, 10, 24, 9, 40), 25, { endedAt: at(2026, 10, 24, 10, 30) })
    expect(secondsWithin(x, at(2026, 10, 24, 10), at(2026, 10, 24, 11))).toBeCloseTo(15 * 60)
  })

  it('splits a session that crosses midnight between days', () => {
    const x = s(at(2026, 10, 24, 23, 50), 20)
    const m = dailyFocus([x])
    expect(m.get('2026-10-24')).toBeCloseTo(600)
    expect(m.get('2026-10-25')).toBeCloseTo(600)
  })

  it('totals a range', () => {
    const r = periodRange('day', at(2026, 10, 24))
    const t = totals(
      [
        s(at(2026, 10, 24, 9), 25, { quality: 4 }),
        s(at(2026, 10, 24, 10), 10, { status: 'abandoned' }),
        s(at(2026, 10, 24, 11), 25, { quality: 2 }),
        s(at(2026, 10, 24, 11, 30), 5, { mode: 'short' }),
        s(at(2026, 10, 24, 12), 25, { deletedAt: 1 }),
        s(at(2026, 10, 23, 12), 25),
      ],
      r,
    )
    expect(t).toMatchObject({ focusSec: 60 * 60, pomodoros: 2, focusSessions: 3, abandoned: 1, avgQuality: 3, activeDays: 1, breakSec: 300 })
    expect(t.completionRate).toBeCloseTo(2 / 3)
  })

  it('groups by bucket and project', () => {
    const r = periodRange('week', at(2026, 10, 21))
    const out = focusByBucket([s(at(2026, 10, 21, 9), 25, { projectId: 'p' }), s(at(2026, 10, 21, 10), 25)], bucketsFor(r), (x) => x.projectId ?? '')
    expect(out[2].get('p')).toBe(1500) // Wednesday
    expect(out[2].get('')).toBe(1500)
  })

  it('counts streaks, letting today still be in progress', () => {
    const now = at(2026, 10, 24, 8)
    const list = [at(2026, 10, 18), at(2026, 10, 19), at(2026, 10, 20), at(2026, 10, 22), at(2026, 10, 23)].map((d) => s(d + 9 * 3_600_000, 25))
    expect(streaks(list, now)).toEqual({ current: 2, longest: 3 })
    expect(streaks([...list, s(at(2026, 10, 24, 7), 25)], now).current).toBe(3)
    expect(streaks([s(at(2026, 10, 20, 9), 25, { status: 'abandoned' })], now)).toEqual({ current: 0, longest: 0 })
  })

  it('profiles hours and finds the best window', () => {
    const r = periodRange('week', at(2026, 10, 21))
    const p = hourProfile([s(at(2026, 10, 21, 9, 30), 60), s(at(2026, 10, 22, 10), 25)], r)
    expect(p[9]).toBeCloseTo(1800)
    expect(p[10]).toBeCloseTo(1800 + 1500)
    expect(bestWindow(p, 2)).toEqual({ start: 9, share: 1 })
  })

  it('measures estimate accuracy and bias on finished tasks', () => {
    const task = (id: string, est: number, done = true): Task => ({ id, title: id, notes: '', projectId: null, est, done, doneAt: done ? at(2026, 10, 22) : null, order: 0, createdAt: 0, updatedAt: 0, deletedAt: null })
    const r = periodRange('week', at(2026, 10, 21))
    const res = estimateAccuracy([task('a', 4), task('b', 2), task('c', 3, false)], new Map([['a', 6], ['b', 2], ['c', 1]]), r)
    expect(res.rows).toHaveLength(2)
    expect(res.accuracy).toBeCloseTo((0.5 + 1) / 2)
    expect(res.bias).toBeCloseTo(0.25)
  })
})
