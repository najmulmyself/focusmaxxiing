import type { SessionRecord } from '../src/timer/engine'
import type { Project, Task } from '../src/data/model'
import { SESSION_COLUMNS, TASK_COLUMNS, sessionRows, taskRows, type Dataset, type Stamps } from '../src/data/formats'
import { allowedEmails } from './auth'
import type { D1Like } from './d1'
import { accessToken, parseServiceAccount, sheetsClient, type Fetch, type SheetProps } from './sheets'

/* Google Sheets mirror: a human-readable copy of the owner's history, rewritten by a cron Worker. */

export interface MirrorEnv {
  DB: D1Like
  /** the first email is the owner whose data is mirrored */
  ALLOWED_EMAILS?: string
  /** the id from the sheet's URL: docs.google.com/spreadsheets/d/<id>/edit */
  SHEET_ID?: string
  /** a service account's JSON key; the sheet must be shared with its email */
  GOOGLE_SERVICE_ACCOUNT?: string
}

/** Even with no changes, rewrite once a day, so hand edits to the mirror tabs don't linger. */
export const REFRESH_MS = 24 * 3600_000

export type MirrorResult =
  | { status: 'off'; reason: string }
  | { status: 'unchanged'; seq: number }
  | { status: 'mirrored'; seq: number; rows: Record<string, number> }

/** Google Sheets date serials (days since 1899-12-30) in the sheet's own time zone. */
export function sheetStamps(timeZone: string): Stamps {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const serial = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 86_400_000 + 25_569
  }
  return { date: (ms) => Math.floor(serial(ms)), time: (ms) => serial(ms) % 1, dateTime: serial }
}

export interface Tab {
  title: string
  head: string[]
  rows: unknown[][]
  /** column index → number format pattern */
  formats: Record<number, string>
}

const DATE = 'yyyy-mm-dd'
const TIME = 'hh:mm'
const DATE_TIME = 'yyyy-mm-dd hh:mm'

export function buildTabs(d: Dataset, stamp: Stamps): Tab[] {
  const live = d.tasks.filter((t) => !t.deletedAt)
  const projectRows = [...d.projects]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const focus = d.sessions.filter((s) => !s.deletedAt && s.mode === 'focus' && s.projectId === p.id)
      return [
        p.name,
        live.filter((t) => t.projectId === p.id).length,
        focus.filter((s) => s.status === 'completed').length,
        Math.round(focus.reduce((n, s) => n + s.actualSec / 60, 0)),
        p.archived ? 'yes' : 'no',
        stamp.dateTime(p.createdAt),
        p.id,
      ]
    })
  return [
    { title: 'Sessions', head: SESSION_COLUMNS, rows: sessionRows(d, stamp), formats: { 0: DATE, 1: TIME, 2: TIME } },
    { title: 'Tasks', head: TASK_COLUMNS, rows: taskRows(d, stamp), formats: { 6: DATE_TIME, 7: DATE_TIME } },
    { title: 'Projects', head: ['project', 'tasks', 'completed_pomodoros', 'focus_minutes', 'archived', 'created_at', 'id'], rows: projectRows, formats: { 5: DATE_TIME } },
  ]
}

async function loadDataset(db: D1Like, user: string): Promise<Dataset> {
  const { results } = await db
    .prepare("SELECT kind, data FROM records WHERE user_id = ? AND kind IN ('session', 'task', 'project')")
    .bind(user)
    .all<{ kind: string; data: string }>()
  const d: Dataset = { sessions: [], tasks: [], projects: [], templates: [] }
  for (const r of results) {
    const x = JSON.parse(r.data)
    if (r.kind === 'session') d.sessions.push(x as SessionRecord)
    else if (r.kind === 'task') d.tasks.push(x as Task)
    else d.projects.push(x as Project)
  }
  return d
}

/** The batchUpdate requests that create missing tabs and size and format every tab. */
export function layoutRequests(tabs: Tab[], existing: SheetProps[]) {
  const requests: unknown[] = []
  let nextId = Math.max(0, ...existing.map((s) => s.sheetId)) + 1
  for (const tab of tabs) {
    let sheet = existing.find((s) => s.title === tab.title)
    if (!sheet) {
      sheet = { sheetId: nextId++, title: tab.title, gridProperties: { columnCount: tab.head.length } }
      requests.push({ addSheet: { properties: { sheetId: sheet.sheetId, title: tab.title } } })
    }
    const sheetId = sheet.sheetId
    requests.push(
      {
        // rows match the data exactly, so stale rows from deleted records disappear;
        // extra columns you add are kept. A second row always exists, so the frozen header is legal.
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { rowCount: Math.max(2, tab.rows.length + 1), columnCount: Math.max(tab.head.length, sheet.gridProperties?.columnCount ?? 0), frozenRowCount: 1 } },
          fields: 'gridProperties(rowCount,columnCount,frozenRowCount)',
        },
      },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ...Object.entries(tab.formats).map(([col, pattern]) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: +col, endColumnIndex: +col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    )
  }
  return requests
}

export async function mirror(env: MirrorEnv, deps: { fetch?: Fetch; now?: () => number } = {}): Promise<MirrorResult> {
  const owner = allowedEmails(env.ALLOWED_EMAILS)[0]
  if (!owner) return { status: 'off', reason: 'ALLOWED_EMAILS is empty' }
  if (!env.SHEET_ID) return { status: 'off', reason: 'SHEET_ID is not set' }
  if (!env.GOOGLE_SERVICE_ACCOUNT) return { status: 'off', reason: 'GOOGLE_SERVICE_ACCOUNT is not set' }
  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init))
  const now = deps.now?.() ?? Date.now()

  // Read the change number before the records: a push in between only means one more run.
  const seq = (await env.DB.prepare('SELECT seq FROM counters WHERE user_id = ?').bind(owner).first<{ seq: number }>())?.seq ?? 0
  const last = await env.DB.prepare('SELECT seq, mirrored_at FROM mirror_state WHERE user_id = ?').bind(owner).first<{ seq: number; mirrored_at: number }>()
  if (last && last.seq === seq && now - last.mirrored_at < REFRESH_MS) return { status: 'unchanged', seq }

  const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT)
  const sheets = sheetsClient(env.SHEET_ID, await accessToken(sa, fetchFn, now), sa, fetchFn)
  const meta = await sheets.meta()
  const tabs = buildTabs(await loadDataset(env.DB, owner), sheetStamps(meta.properties.timeZone || 'UTC'))

  // Size first, then write, so there's never a moment with stale rows below new data.
  await sheets.batchUpdate(layoutRequests(tabs, meta.sheets.map((s) => s.properties)))
  await sheets.writeValues(tabs.map((t) => ({ range: `'${t.title}'!A1`, values: [t.head, ...t.rows].map((r) => r.map((v) => v ?? '')) })))

  await env.DB.prepare('INSERT INTO mirror_state (user_id, seq, mirrored_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, mirrored_at = excluded.mirrored_at')
    .bind(owner, seq, now)
    .run()
  return { status: 'mirrored', seq, rows: Object.fromEntries(tabs.map((t) => [t.title, t.rows.length])) }
}
