import { useCallback, useEffect, useState } from 'react'

interface DocumentPiP {
  requestWindow(opts: { width: number; height: number }): Promise<Window>
  window: Window | null
}
const dpip = () => (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture

export const pipSupported = () => typeof window !== 'undefined' && !!dpip()

/** Copy every stylesheet into the PiP document so the portal renders with the app's CSS. */
function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement('style')
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n')
      target.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.head.appendChild(link)
      }
    }
  }
}

/** Document Picture-in-Picture: an always-on-top mini window (Chromium browsers). */
export function usePip(rootAttrs: Record<string, string | undefined>) {
  const [win, setWin] = useState<Window | null>(null)

  const open = useCallback(async () => {
    const api = dpip()
    if (!api) return
    if (api.window) return api.window.focus()
    const w = await api.requestWindow({ width: 320, height: 380 })
    copyStyles(w.document)
    w.document.title = 'focusmaxxiing'
    w.addEventListener('pagehide', () => setWin(null), { once: true })
    setWin(w)
  }, [])

  const close = useCallback(() => win?.close(), [win])

  // mirror theme/mode attributes so tokens resolve the same way inside the PiP window
  useEffect(() => {
    if (!win) return
    const root = win.document.documentElement
    for (const [k, v] of Object.entries(rootAttrs)) {
      if (v === undefined) delete root.dataset[k]
      else root.dataset[k] = v
    }
  })

  return { win, open, close, supported: pipSupported() }
}
