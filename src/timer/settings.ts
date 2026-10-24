import type { TimerSettings } from './engine'

export type AlarmSound = 'anvil' | 'bell' | 'kitchen' | 'chime' | 'none'
export type Ambient = 'none' | 'fire' | 'rain' | 'brown'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings extends TimerSettings {
  alarm: AlarmSound
  alarmVolume: number
  alarmRepeat: number
  ambient: Ambient
  ambientVolume: number
  notifications: boolean
  theme: Theme
}

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  alarm: 'anvil',
  alarmVolume: 0.6,
  alarmRepeat: 1,
  ambient: 'none',
  ambientVolume: 0.35,
  notifications: false,
  theme: 'system',
}

const clampNum = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

/** Merge untrusted stored settings over defaults, clamping every field. */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const d = DEFAULT_SETTINGS
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T) => (ok.includes(v as T) ? (v as T) : def)
  return {
    focusMin: clampNum(r.focusMin, 1, 180, d.focusMin),
    shortMin: clampNum(r.shortMin, 1, 60, d.shortMin),
    longMin: clampNum(r.longMin, 1, 90, d.longMin),
    longInterval: Math.round(clampNum(r.longInterval, 1, 12, d.longInterval)),
    autoStartBreaks: typeof r.autoStartBreaks === 'boolean' ? r.autoStartBreaks : d.autoStartBreaks,
    autoStartFocus: typeof r.autoStartFocus === 'boolean' ? r.autoStartFocus : d.autoStartFocus,
    alarm: pick(r.alarm, ['anvil', 'bell', 'kitchen', 'chime', 'none'] as const, d.alarm),
    alarmVolume: clampNum(r.alarmVolume, 0, 1, d.alarmVolume),
    alarmRepeat: Math.round(clampNum(r.alarmRepeat, 1, 5, d.alarmRepeat)),
    ambient: pick(r.ambient, ['none', 'fire', 'rain', 'brown'] as const, d.ambient),
    ambientVolume: clampNum(r.ambientVolume, 0, 1, d.ambientVolume),
    notifications: typeof r.notifications === 'boolean' ? r.notifications : d.notifications,
    theme: pick(r.theme, ['system', 'light', 'dark'] as const, d.theme),
  }
}
