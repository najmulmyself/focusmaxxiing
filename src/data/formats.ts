import type { SessionRecord } from '../timer/engine'
import type { Settings } from '../timer/settings'
import type { Project, Task, Template } from './model'

/* Pure export/import formats. No IndexedDB here, so everything is unit-testable. */

export interface Dataset {
  sessions: SessionRecord[]
  tasks: Task[]
  projects: Project[]
  templates: Template[]
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Local wall-clock "YYYY-MM-DD HH:MM", what a person expects to read in a spreadsheet. */
export const localStamp = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/* CSV (RFC 4180)                                                      */
/* ------------------------------------------------------------------ */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  let s = String(v)
  // spreadsheet formula-injection guard: text starting with = + - @ would run as a formula
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  // quote anything with a delimiter, quote, or line break; double inner quotes
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(head: string[], rows: unknown[][]): string {
  // BOM so Excel opens it as UTF-8
  return '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

const MODE = { focus: 'Focus', short: 'Short break', long: 'Long break' } as const
const STATUS = { completed: 'Completed', skipped: 'Skipped', abandoned: 'Unfinished' } as const

/** How a table writes times: text for CSV, date serials for Google Sheets. */
export interface Stamps {
  date(ms: number): string | number
  time(ms: number): string | number
  dateTime(ms: number): string | number
}
const textStamps: Stamps = { date: (ms) => localStamp(ms).slice(0, 10), time: (ms) => localStamp(ms).slice(11), dateTime: localStamp }

export const SESSION_COLUMNS = ['date', 'start', 'end', 'minutes', 'type', 'outcome', 'task', 'project', 'focus_rating', 'note', 'pauses', 'start_utc', 'end_utc', 'id']

export function sessionRows(d: Dataset, stamp: Stamps = textStamps): unknown[][] {
  const tasks = new Map(d.tasks.map((t) => [t.id, t]))
  const projects = new Map(d.projects.map((p) => [p.id, p]))
  return d.sessions
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => [
      stamp.date(s.startedAt),
      stamp.time(s.startedAt),
      stamp.time(s.endedAt),
      +(s.actualSec / 60).toFixed(2),
      MODE[s.mode],
      STATUS[s.status],
      s.taskId ? (tasks.get(s.taskId)?.title ?? '') : '',
      s.projectId ? (projects.get(s.projectId)?.name ?? '') : '',
      s.quality ?? '',
      s.note,
      s.pauses,
      new Date(s.startedAt).toISOString(),
      new Date(s.endedAt).toISOString(),
      s.id,
    ])
}

export const sessionsCSV = (d: Dataset): string => toCSV(SESSION_COLUMNS, sessionRows(d))

export const TASK_COLUMNS = ['task', 'project', 'estimated_pomodoros', 'completed_pomodoros', 'focus_minutes', 'done', 'done_at', 'created_at', 'cleared', 'notes', 'id']

/** Completed pomodoros and focus minutes per task, from the session log. */
function focusByTask(sessions: SessionRecord[]) {
  const done = new Map<string, number>()
  const minutes = new Map<string, number>()
  for (const s of sessions) {
    if (s.deletedAt || s.mode !== 'focus' || !s.taskId) continue
    minutes.set(s.taskId, (minutes.get(s.taskId) ?? 0) + s.actualSec / 60)
    if (s.status === 'completed') done.set(s.taskId, (done.get(s.taskId) ?? 0) + 1)
  }
  return { done, minutes }
}

export function taskRows(d: Dataset, stamp: Stamps = textStamps): unknown[][] {
  const projects = new Map(d.projects.map((p) => [p.id, p]))
  const { done, minutes } = focusByTask(d.sessions)
  return [...d.tasks]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => [
      t.title,
      t.projectId ? (projects.get(t.projectId)?.name ?? '') : '',
      t.est,
      done.get(t.id) ?? 0,
      Math.round(minutes.get(t.id) ?? 0),
      t.done ? 'yes' : 'no',
      t.doneAt ? stamp.dateTime(t.doneAt) : '',
      stamp.dateTime(t.createdAt),
      t.deletedAt ? 'yes' : 'no',
      t.notes,
      t.id,
    ])
}

export const tasksCSV = (d: Dataset): string => toCSV(TASK_COLUMNS, taskRows(d))

/* ------------------------------------------------------------------ */
/* iCalendar (RFC 5545)                                                */
/* ------------------------------------------------------------------ */

const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Fold lines longer than 75 octets (UTF-8), continuing with a single space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const parts: string[] = []
  let cur = ''
  for (const ch of line) {
    const limit = parts.length ? 74 : 75 // continuation lines start with a space
    if (enc.encode(cur + ch).length > limit) {
      parts.push(cur)
      cur = ch
    } else cur += ch
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

/** Focus sessions as calendar events, so your focus shows up next to your meetings. */
export function sessionsICS(d: Dataset, now = Date.now()): string {
  const tasks = new Map(d.tasks.map((t) => [t.id, t]))
  const projects = new Map(d.projects.map((p) => [p.id, p]))
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//focusmaxxiing//focus sessions//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Focus sessions']
  for (const s of d.sessions) {
    if (s.deletedAt || s.mode !== 'focus') continue
    const task = s.taskId ? tasks.get(s.taskId)?.title : undefined
    const project = s.projectId ? projects.get(s.projectId)?.name : undefined
    const desc = [
      `${Math.round(s.actualSec / 60)} minutes focused (${STATUS[s.status].toLowerCase()})`,
      s.quality ? `Focus rating: ${s.quality}/5` : '',
      s.note,
    ].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@focusmaxxiing`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(s.startedAt)}`,
      `DTEND:${icsDate(Math.max(s.endedAt, s.startedAt + 60_000))}`,
      `SUMMARY:${icsText(task ? `Focus: ${task}` : 'Focus')}`,
      `DESCRIPTION:${icsText(desc)}`,
      ...(project ? [`CATEGORIES:${icsText(project)}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/* ------------------------------------------------------------------ */
/* JSON backup                                                         */
/* ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 'focusmaxxiing-backup'
export const BACKUP_VERSION = 1

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  app: { device: string }
  settings: Settings | null
  counts: Record<keyof Dataset, number>
  data: Dataset
}

/** Everything, including soft-deleted rows, so a restore is exact. */
export function buildBackup(d: Dataset, settings: Settings | null, device: string, now = Date.now()): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    app: { device },
    settings,
    counts: { sessions: d.sessions.length, tasks: d.tasks.length, projects: d.projects.length, templates: d.templates.length },
    data: d,
  }
}

export class BackupError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => typeof v === 'string' && v.length > 0
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** Parse and validate a backup file. Throws BackupError with a message a person can act on. */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new BackupError("This file isn't valid JSON. Choose a backup exported from focusmaxxiing (a .json file).")
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError("This isn't a focusmaxxiing backup. Choose the .json file from “Export backup”.")
  if (!num(raw.version) || (raw.version as number) > BACKUP_VERSION)
    throw new BackupError('This backup was made by a newer version of focusmaxxiing. Update the app, then try again.')
  const data = raw.data
  if (!isObj(data)) throw new BackupError('This backup is missing its data section.')
  const list = (k: keyof Dataset) => {
    const v = data[k]
    if (v === undefined) return []
    if (!Array.isArray(v)) throw new BackupError(`The “${k}” section of this backup is damaged.`)
    return v as unknown[]
  }
  const sessions = list('sessions')
  const tasks = list('tasks')
  const projects = list('projects')
  const templates = list('templates')
  const bad = (k: string, i: number) => new BackupError(`Record ${i + 1} in “${k}” is damaged, so nothing was imported.`)
  sessions.forEach((s, i) => {
    if (!isObj(s) || !str(s.id) || !num(s.startedAt) || !num(s.endedAt) || !num(s.actualSec) || !['focus', 'short', 'long'].includes(s.mode as string)) throw bad('sessions', i)
  })
  tasks.forEach((t, i) => {
    if (!isObj(t) || !str(t.id) || typeof t.title !== 'string' || !num(t.est)) throw bad('tasks', i)
  })
  projects.forEach((p, i) => {
    if (!isObj(p) || !str(p.id) || typeof p.name !== 'string') throw bad('projects', i)
  })
  templates.forEach((t, i) => {
    if (!isObj(t) || !str(t.id) || !Array.isArray(t.items)) throw bad('templates', i)
  })
  return {
    ...(raw as unknown as Backup),
    settings: isObj(raw.settings) ? (raw.settings as unknown as Settings) : null,
    data: {
      sessions: sessions as SessionRecord[],
      tasks: tasks as Task[],
      projects: projects as Project[],
      templates: templates as Template[],
    },
  }
}

export interface MergeResult<T> {
  put: T[]
  added: number
  updated: number
  unchanged: number
}

/**
 * Merge incoming records into existing ones by id. The newer version wins:
 * higher `revision` for sessions, later `updatedAt` for everything else.
 * Nothing that exists locally is ever removed by a merge.
 */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[], version: (r: T) => number): MergeResult<T> {
  const have = new Map(existing.map((r) => [r.id, r]))
  const put: T[] = []
  let added = 0, updated = 0, unchanged = 0
  for (const r of incoming) {
    const cur = have.get(r.id)
    if (!cur) {
      put.push(r)
      added++
    } else if (version(r) > version(cur)) {
      put.push(r)
      updated++
    } else unchanged++
  }
  return { put, added, updated, unchanged }
}

export const sessionVersion = (s: SessionRecord) => s.revision ?? 1
export const updatedVersion = (r: { updatedAt?: number }) => r.updatedAt ?? 0
