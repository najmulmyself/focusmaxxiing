import { describe, expect, it } from 'vitest'
import { initialState, start, type TimerSettings } from './engine'
import { estimateFinish } from './plan'

const S: TimerSettings = { focusMin: 25, shortMin: 5, longMin: 15, longInterval: 4, autoStartBreaks: false, autoStartFocus: false }
const MIN = 60_000
const T0 = 1_700_000_000_000

describe('estimateFinish', () => {
  it('is zero with nothing left', () => {
    expect(estimateFinish(0, initialState(S), S, T0).totalMs).toBe(0)
  })

  it('adds short breaks between pomodoros, none after the last', () => {
    // 3 × 25 + 2 × 5
    expect(estimateFinish(3, initialState(S), S, T0).totalMs).toBe(85 * MIN)
  })

  it('inserts a long break after every 4th pomodoro', () => {
    // 5 × 25 + 3 × 5 + 1 × 15
    expect(estimateFinish(5, initialState(S), S, T0).totalMs).toBe(155 * MIN)
  })

  it('counts the running session from what is left of it', () => {
    const t = start(initialState(S), T0, 'a')
    // 15 left of the current one, then a break and one more
    expect(estimateFinish(2, t, S, T0 + 10 * MIN).totalMs).toBe((15 + 5 + 25) * MIN)
  })

  it('finishes the current break first', () => {
    const t = start(initialState(S, 'short'), T0, 'a')
    expect(estimateFinish(1, t, S, T0 + 2 * MIN).totalMs).toBe((3 + 25) * MIN)
  })
})
