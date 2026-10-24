import { describe, expect, it } from 'vitest'
import { applySettings, complete, elapsed, initialState, isDue, pause, remaining, reset, skip, start, type TimerSettings } from './engine'

const S: TimerSettings = { focusMin: 25, shortMin: 5, longMin: 15, longInterval: 4, autoStartBreaks: false, autoStartFocus: false }
const MIN = 60_000
const T0 = 1_700_000_000_000

describe('timer engine', () => {
  it('counts down from wall-clock time', () => {
    const t = start(initialState(S), T0, 'a')
    expect(remaining(t, T0)).toBe(25 * MIN)
    expect(remaining(t, T0 + 10 * MIN)).toBe(15 * MIN)
    expect(isDue(t, T0 + 25 * MIN)).toBe(true)
  })

  it('banks time across pauses', () => {
    let t = start(initialState(S), T0, 'a')
    t = pause(t, T0 + 5 * MIN)
    expect(remaining(t, T0 + 60 * MIN)).toBe(20 * MIN) // paused: frozen
    t = start(t, T0 + 60 * MIN, 'ignored')
    expect(t.sessionId).toBe('a')
    expect(t.pauses).toBe(1)
    expect(elapsed(t, T0 + 63 * MIN)).toBe(8 * MIN)
  })

  it('completes focus into a short break, and every 4th into a long break', () => {
    let t = initialState(S)
    const modes: string[] = []
    for (let i = 0; i < 8; i++) {
      t = start(t, T0, `s${i}`)
      const r = complete(t, T0 + t.plannedMs, S, 'test', `n${i}`)
      expect(r.record?.status).toBe('completed')
      t = r.state
      modes.push(t.mode)
    }
    expect(modes).toEqual(['short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus'])
  })

  it('keeps the true end time when completed long after it was due', () => {
    const t = start(initialState(S), T0, 'a')
    const r = complete(t, T0 + 3 * 60 * MIN, { ...S, autoStartBreaks: true }, 'test', 'b')
    expect(r.record!.endedAt).toBe(T0 + 25 * MIN)
    expect(r.record!.actualSec).toBe(25 * 60)
    expect(r.state.status).toBe('idle') // no auto-start chain while away
  })

  it('auto-starts the break when finishing on time', () => {
    const t = start(initialState(S), T0, 'a')
    const r = complete(t, T0 + 25 * MIN + 300, { ...S, autoStartBreaks: true }, 'test', 'b')
    expect(r.state.mode).toBe('short')
    expect(r.state.status).toBe('running')
    expect(r.state.segmentStart).toBe(T0 + 25 * MIN)
  })

  it('logs resets and skips only past one minute', () => {
    const t = start(initialState(S), T0, 'a')
    expect(reset(t, T0 + 30_000, S, 'x').record).toBeNull()
    const r = reset(t, T0 + 7 * MIN, S, 'x')
    expect(r.record).toMatchObject({ status: 'abandoned', actualSec: 7 * 60, id: 'a' })
    expect(r.state.status).toBe('idle')
    const k = skip(t, T0 + 20 * MIN, S, 'x')
    expect(k.record).toMatchObject({ status: 'skipped', actualSec: 20 * 60 })
    expect(k.state.mode).toBe('short')
  })

  it('applies new durations only when idle', () => {
    const t = initialState(S)
    expect(applySettings(t, { ...S, focusMin: 50 }).plannedMs).toBe(50 * MIN)
    const running = start(t, T0, 'a')
    expect(applySettings(running, { ...S, focusMin: 50 }).plannedMs).toBe(25 * MIN)
  })
})
