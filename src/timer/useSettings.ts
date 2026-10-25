import { useCallback, useEffect, useState } from 'react'
import { KEYS, readJSON, writeJSON } from '../data/local'
import { sanitize, type Settings } from './settings'

/** fired after the user changes settings, and after sync applies settings from another device */
export const SETTINGS_SAVED = 'fm:settings-saved'
export const SETTINGS_SYNCED = 'fm:settings-synced'

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => sanitize(readJSON(KEYS.settings)))

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = sanitize({ ...prev, ...patch })
      writeJSON(KEYS.settings, next)
      writeJSON(KEYS.settingsAt, Date.now())
      window.dispatchEvent(new Event(SETTINGS_SAVED))
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
    // settings written by sync (same tab, so no storage event)
    const onSynced = () => setSettings(sanitize(readJSON(KEYS.settings)))
    window.addEventListener('storage', onStorage)
    window.addEventListener(SETTINGS_SYNCED, onSynced)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SETTINGS_SYNCED, onSynced)
    }
  }, [])

  // theme
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = settings.theme
  }, [settings.theme])

  return [settings, update] as const
}
