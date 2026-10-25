/** localStorage wrapper that never throws (private mode, quota, blocked storage). */
export const KEYS = {
  timer: 'fm.timer.v1',
  settings: 'fm.settings.v1',
  pending: 'fm.pending.v1',
  device: 'fm.device.v1',
  /** when settings last changed, so sync can tell which device's settings are newer */
  settingsAt: 'fm.settingsAt.v1',
  sync: 'fm.sync.v1',
} as const

export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Stable per-browser id, recorded on sessions so multi-device history stays traceable. */
export function deviceId(): string {
  const existing = readJSON<string>(KEYS.device)
  if (existing) return existing
  const ua = navigator.userAgent
  const kind = /Mobi|Android|iPhone/.test(ua) ? 'phone' : /iPad|Tablet/.test(ua) ? 'tablet' : 'desktop'
  const id = `${kind}-${uid().slice(0, 8)}`
  writeJSON(KEYS.device, id)
  return id
}
