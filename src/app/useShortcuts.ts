import { useEffect, useRef } from 'react'

export type Shortcut = { keys: string[]; label: string; run: () => void }

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** Single-key shortcuts, ignored while typing or with modifiers held. Listens on extra windows too (PiP). */
export function useShortcuts(shortcuts: Shortcut[], enabled: boolean, extraWindows: (Window | null)[] = []) {
  const ref = useRef(shortcuts)
  ref.current = shortcuts
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || e.repeat) return
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key
      const hit = ref.current.find((s) => s.keys.includes(key))
      if (!hit) return
      // let Space still activate a focused button rather than double-firing
      if (key === 'Space' && (e.target as HTMLElement)?.tagName === 'BUTTON') return
      e.preventDefault()
      hit.run()
    }
    const wins = [window, ...extraWindows.filter((w): w is Window => !!w)]
    wins.forEach((w) => w.addEventListener('keydown', onKey))
    return () => wins.forEach((w) => w.removeEventListener('keydown', onKey))
  }, [enabled, ...extraWindows])
}
