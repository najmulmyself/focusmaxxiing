import { useCallback, useEffect, useRef, useState } from 'react'
import { saveSession, flushPending } from '../data/db'
import { KEYS, deviceId, readJSON, uid, writeJSON } from '../data/local'
import * as E from './engine'
import type { Settings } from './settings'

export interface TimerEvent {
  kind: 'completed' | 'abandoned' | 'skipped'
  record: E.SessionRecord | null
  /** finished while the app was closed or asleep */
  away: boolean
  at: number
}

function loadState(s: Settings): E.TimerState {
  const saved = readJSON<E.TimerState>(KEYS.timer)
  if (saved && saved.v === 1 && ['focus', 'short', 'long'].includes(saved.mode) && ['idle', 'running', 'paused'].includes(saved.status)) {
    return E.applySettings(saved, s)
  }
  return E.initialState(s)
}

/**
 * Ticks from a Web Worker: background tabs throttle main-thread timers to
 * once a minute, which would make the alarm late. Worker timers aren't.
 */
function startTicker(onTick: () => void): () => void {
  try {
    const src = 'setInterval(() => postMessage(0), 250)'
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url)
    w.onmessage = onTick
    return () => {
      w.terminate()
      URL.revokeObjectURL(url)
    }
  } catch {
    const id = setInterval(onTick, 250)
    return () => clearInterval(id)
  }
}

/**
 * One tab is the leader (Web Locks): it completes sessions, plays the alarm and
 * notifies. Other tabs mirror state through the storage event.
 */
function useLeader(): React.RefObject<boolean> {
  const leader = useRef(!('locks' in navigator))
  useEffect(() => {
    if (!('locks' in navigator)) return
    const ctl = new AbortController()
    navigator.locks
      .request('fm-timer-leader', { signal: ctl.signal }, () => {
        leader.current = true
        return new Promise<void>(() => {}) // hold until the tab closes
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  return leader
}

export function useTimer(settings: Settings, onEvent: (e: TimerEvent, isLeader: boolean) => void) {
  const [state, setState] = useState(() => loadState(settings))
  const [now, setNow] = useState(() => Date.now())
  const stateRef = useRef(state)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const leader = useLeader()
  const device = useRef(deviceId())

  const commit = useCallback((next: E.TimerState) => {
    stateRef.current = next
    writeJSON(KEYS.timer, next)
    setState(next)
  }, [])

  const emit = useCallback((kind: TimerEvent['kind'], t: E.Transition, away = false) => {
    if (t.record) void saveSession(t.record)
    onEventRef.current({ kind, record: t.record, away, at: Date.now() }, leader.current)
  }, [leader])

  // completion check, run on every tick and whenever the tab wakes up
  const check = useCallback(() => {
    const n = Date.now()
    setNow(n)
    const t = stateRef.current
    if (!E.isDue(t, n) || !leader.current) return
    const dueAt = (t.segmentStart ?? n) + (t.plannedMs - t.bankedMs)
    const tr = E.complete(t, n, settingsRef.current, device.current, uid())
    commit(tr.state)
    emit('completed', tr, n - dueAt > 5_000)
  }, [commit, emit, leader])

  useEffect(() => {
    void flushPending()
    check()
  }, [check])

  useEffect(() => {
    if (state.status !== 'running') return
    return startTicker(check)
  }, [state.status, check])

  useEffect(() => {
    const wake = () => check()
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEYS.timer || !e.newValue) return
      try {
        const next = JSON.parse(e.newValue) as E.TimerState
        stateRef.current = next
        setState(next)
      } catch {
        /* ignore malformed */
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('storage', onStorage)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('storage', onStorage)
    }
  }, [check])

  // new durations apply to an idle timer straight away
  useEffect(() => {
    const t = stateRef.current
    const next = E.applySettings(t, settings)
    if (next.plannedMs !== t.plannedMs) commit(next)
  }, [settings, commit])

  const api = {
    state,
    now,
    remainingMs: E.remaining(state, now),
    progress: state.plannedMs ? E.elapsed(state, now) / state.plannedMs : 0,
    start: () => commit(E.start(stateRef.current, Date.now(), uid())),
    pause: () => commit(E.pause(stateRef.current, Date.now())),
    toggle: () => {
      const t = stateRef.current
      commit(t.status === 'running' ? E.pause(t, Date.now()) : E.start(t, Date.now(), uid()))
    },
    reset: () => {
      const tr = E.reset(stateRef.current, Date.now(), settingsRef.current, device.current)
      commit(tr.state)
      if (tr.record) emit('abandoned', tr)
    },
    skip: () => {
      const tr = E.skip(stateRef.current, Date.now(), settingsRef.current, device.current)
      commit(tr.state)
      emit('skipped', tr)
    },
    /** Credit the current (and following) sessions to a task. */
    selectTask: (taskId: string | null, projectId: string | null) => commit(E.setTask(stateRef.current, { taskId, projectId })),
    switchMode: (mode: E.Mode) => {
      const tr = E.reset(stateRef.current, Date.now(), settingsRef.current, device.current, mode)
      commit(tr.state)
      if (tr.record) emit('abandoned', tr)
    },
  }
  return api
}

export type TimerApi = ReturnType<typeof useTimer>
