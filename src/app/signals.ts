import { useEffect, useRef } from 'react'
import type { Mode, Status } from '../timer/engine'

export const MODE_LABEL: Record<Mode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' }
const MODE_COLOR: Record<Mode, string> = { focus: '#E4572E', short: '#7FA38A', long: '#3E5C76' }

export const fmtClock = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Live countdown in the tab title and a progress-ring favicon while a session is underway. */
export function useTabSignals(mode: Mode, status: Status, remainingMs: number, progress: number) {
  const original = useRef<string | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const lastDrawn = useRef('')

  useEffect(() => {
    document.title = status === 'idle' ? 'focusmaxxiing' : `${fmtClock(remainingMs)} · ${MODE_LABEL[mode]}${status === 'paused' ? ' (paused)' : ''}`
  }, [mode, status, remainingMs])

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    if (original.current === null) original.current = link.href
    if (status === 'idle') {
      link.type = 'image/svg+xml'
      link.href = original.current
      lastDrawn.current = ''
      return
    }
    // redraw at most ~100 steps per session
    const step = `${mode}-${status}-${Math.floor(progress * 100)}`
    if (step === lastDrawn.current) return
    lastDrawn.current = step
    const c = (canvas.current ??= document.createElement('canvas'))
    c.width = c.height = 64
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, 64, 64)
    g.fillStyle = MODE_COLOR[mode]
    g.beginPath()
    g.arc(32, 32, 30, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 9
    g.strokeStyle = 'rgba(29,27,24,0.25)'
    g.beginPath()
    g.arc(32, 32, 19, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = '#FFF8EF'
    g.lineCap = 'round'
    g.beginPath()
    g.arc(32, 32, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, 1 - progress))
    g.stroke()
    if (status === 'paused') {
      g.fillStyle = '#FFF8EF'
      g.fillRect(25, 23, 5, 18)
      g.fillRect(34, 23, 5, 18)
    }
    link.type = 'image/png'
    link.href = c.toDataURL('image/png')
  }, [mode, status, progress])
}
