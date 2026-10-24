import { useCallback, useEffect, useState } from 'react'
import { KEYS, readJSON, writeJSON } from '../data/local'
import { sanitize, type Settings } from './settings'

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => sanitize(readJSON(KEYS.settings)))

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = sanitize({ ...prev, ...patch })
      writeJSON(KEYS.settings, next)
      return next
    })
  }, [])

  // keep tabs in sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS.settings && e.newValue) {
        try {
          setSettings(sanitize(JSON.parse(e.newValue)))
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // theme
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = settings.theme
  }, [settings.theme])

  return [settings, update] as const
}
