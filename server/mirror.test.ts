import { beforeEach, describe, expect, it } from 'vitest'
import type { D1Like } from './d1'
import { REFRESH_MS, mirror, sheetStamps, type MirrorEnv } from './mirror'
import type { Fetch } from './sheets'
import { push } from './sync'
import { memoryD1 } from './testdb'

const OWNER = 'me@example.com'
const SHEET = 'sheet-123'
const NOW = Date.UTC(2026, 9, 25, 12)
const SA_EMAIL = 'mirror@focusmaxxiing.iam.gserviceaccount.com'

let keys: CryptoKeyPair
let pem: string

/** A fake Google: checks the signed JWT, then keeps a spreadsheet in memory. */
function fakeGoogle(opts: { timeZone?: string; deny?: boolean } = {}) {
  const sheets = [{ sheetId: 0, title: 'Sheet1', rowCount: 1000, columnCount: 26, values: [] as unknown[][] }]
  const calls: string[] = []
  const fetchFn: Fetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*/, '')}`)
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = new URLSearchParams(String(init?.body)).get('assertion')!
      const [h, p, s] = jwt.split('.')
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`))
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
      expect(ok).toBe(true)
      expect(claims).toMatchObject({ iss: SA_EMAIL, aud: url, scope: 'https://www.googleapis.com/auth/spreadsheets' })
      expect(claims.exp - claims.iat).toBe(3600)
      return Response.json({ access_token: 'tok', expires_in: 3600 })
    }
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
    if (opts.deny) return Response.json({ error: { message: 'The caller does not have permission' } }, { status: 403 })
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`
    if (url.startsWith(`${base}?`)) {
      return Response.json({
        properties: { title: 'Focus', timeZone: opts.timeZone ?? 'UTC' },
        sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title, gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount } } })),
      })
    }
    const body = JSON.parse(String(init?.body))
    if (url === `${base}:batchUpdate`) {
      for (const r of body.requests) {
        if (r.addSheet) sheets.push({ ...r.addSheet.properties, rowCount: 1000, columnCount: 26, values: [] })
        if (r.updateSheetProperties) {
          const s = sheets.find((x) => x.sheetId === r.updateSheetProperties.properties.sheetId)!
          const g = r.updateSheetProperties.properties.gridProperties
          Object.assign(s, { rowCount: g.rowCount, columnCount: g.columnCount, values: s.values.slice(0, g.rowCount) })
        }
      }
      return Response.json({})
    }
    if (url === `${base}/values:batchUpdate`) {
      expect(body.valueInputOption).toBe('RAW')
      for (const { range, values } of body.data) {
        const s = sheets.find((x) => range === `'${x.title}'!A1`)!
        expect(values.length).toBeLessThanOrEqual(s.rowCount) // sized before it's written
        s.values = values.concat(s.values.slice(values.length))
      }
      return Response.json({})
    }
    throw new Error(`unexpected ${url}`)
  }
  const tab = (title: string) => sheets.find((s) => s.title === title)!
  return { fetchFn, calls, sheets, tab }
}

const session = (id: string, startedAt: number, extra: Record<string, unknown> = {}) => ({
  kind: 'session' as const,
  id,
  version: 1,
  data: { id, mode: 'focus', status: 'completed', plannedSec: 1500, actualSec: 1500, startedAt, endedAt: startedAt + 1_500_000, pauses: 0, taskId: 't1', projectId: 'p1', note: '=HYPERLINK("x")', quality: 4, device: 'd', createdAt: startedAt, revision: 1, ...extra },
})
const task = { kind: 'task' as const, id: 't1', version: 1, data: { id: 't1', title: 'Write report', notes: '', projectId: 'p1', est: 3, done: false, doneAt: null, order: 0, createdAt: NOW - 86_400_000, updatedAt: NOW, deletedAt: null } }
const project = { kind: 'project' as const, id: 'p1', version: 1, data: { id: 'p1', name: 'Work', color: 1, archived: false, order: 0, createdAt: NOW - 86_400_000, updatedAt: NOW } }

let db: D1Like
let env: MirrorEnv
beforeEach(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
  db = memoryD1()
  env = { DB: db, ALLOWED_EMAILS: `${OWNER}, other@example.com`, SHEET_ID: SHEET, GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: SA_EMAIL, private_key: pem }) }
  await push(db, OWNER, [project, task, session('s1', NOW - 7_200_000), session('s2', NOW - 3_600_000)])
})

describe('sheet times', () => {
  it('are date serials in the sheet’s time zone', () => {
    const st = sheetStamps('Asia/Dhaka') // UTC+6
    const day = Date.UTC(2026, 9, 25) / 86_400_000 + 25_569
    expect(st.date(NOW)).toBe(day)
    expect(st.time(NOW)).toBeCloseTo(0.75, 9) // 18:00
    expect(st.dateTime(Date.UTC(2026, 9, 25, 20))).toBeCloseTo(day + 1 + 2 / 24, 9) // already the 26th in Dhaka
  })
})

describe('mirror', () => {
  it('stays off, calling nobody, until it is configured', async () => {
    const g = fakeGoogle()
    expect(await mirror({ ...env, SHEET_ID: '' }, { fetch: g.fetchFn, now: () => NOW })).toEqual({ status: 'off', reason: 'SHEET_ID is not set' })
    expect(await mirror({ ...env, GOOGLE_SERVICE_ACCOUNT: undefined }, { fetch: g.fetchFn, now: () => NOW })).toMatchObject({ status: 'off' })
    expect(g.calls).toEqual([])
  })

  it('creates the tabs and writes the owner’s history', async () => {
    const g = fakeGoogle({ timeZone: 'Asia/Dhaka' })
    await push(db, 'other@example.com', [session('elsewhere', NOW)])
    expect(await mirror(env, { fetch: g.fetchFn, now: () => NOW })).toEqual({ status: 'mirrored', seq: 4, rows: { Sessions: 2, Tasks: 1, Projects: 1 } })

    expect(g.sheets.map((s) => s.title)).toEqual(['Sheet1', 'Sessions', 'Tasks', 'Projects'])
    const sessions = g.tab('Sessions')
    expect(sessions.rowCount).toBe(3)
    expect(sessions.values[0]).toEqual(['date', 'start', 'end', 'minutes', 'type', 'outcome', 'task', 'project', 'focus_rating', 'note', 'pauses', 'start_utc', 'end_utc', 'id'])
    const [date, start, , minutes, type, outcome, taskName, projectName, rating, note] = sessions.values[1] as number[]
    expect(date).toBe(Date.UTC(2026, 9, 25) / 86_400_000 + 25_569)
    expect(start).toBeCloseTo(16 / 24, 9) // 10:00 UTC is 16:00 in Dhaka
    expect([minutes, type, outcome, taskName, projectName, rating]).toEqual([25, 'Focus', 'Completed', 'Write report', 'Work', 4])
    expect(note).toBe('=HYPERLINK("x")') // written RAW: stays text, never runs
    expect(g.tab('Tasks').values[1].slice(0, 5)).toEqual(['Write report', 'Work', 3, 2, 50])
    expect(g.tab('Projects').values[1].slice(0, 5)).toEqual(['Work', 1, 2, 50, 'no'])
  })

  it('skips hours with no changes, and catches up on edits and deletes', async () => {
    const g = fakeGoogle()
    await mirror(env, { fetch: g.fetchFn, now: () => NOW })
    const n = g.calls.length
    expect(await mirror(env, { fetch: g.fetchFn, now: () => NOW + 3600_000 })).toEqual({ status: 'unchanged', seq: 4 })
    expect(g.calls.length).toBe(n)

    await push(db, OWNER, [session('s2', NOW - 3_600_000, { deletedAt: NOW, revision: 2 }), session('s3', NOW - 600_000)].map((r, i) => ({ ...r, version: 2 + i })))
    expect(await mirror(env, { fetch: g.fetchFn, now: () => NOW + 7200_000 })).toMatchObject({ status: 'mirrored', rows: { Sessions: 2 } })
    expect(g.tab('Sessions').values.map((r) => r[13])).toEqual(['id', 's1', 's3'])
    expect(g.sheets.length).toBe(4) // tabs are reused, not duplicated
  })

  it('rewrites once a day even with no changes', async () => {
    const g = fakeGoogle()
    await mirror(env, { fetch: g.fetchFn, now: () => NOW })
    g.tab('Sessions').values[1][4] = 'edited by hand'
    expect(await mirror(env, { fetch: g.fetchFn, now: () => NOW + REFRESH_MS })).toMatchObject({ status: 'mirrored' })
    expect(g.tab('Sessions').values[1][4]).toBe('Focus')
  })

  it('says how to fix a sheet it can’t reach, and tries again next time', async () => {
    const g = fakeGoogle({ deny: true })
    await expect(mirror(env, { fetch: g.fetchFn, now: () => NOW })).rejects.toThrow(`Share it with ${SA_EMAIL} as an editor`)
    expect(await db.prepare('SELECT * FROM mirror_state').first()).toBeNull()
  })

  it('refuses a key that is not a service account', async () => {
    await expect(mirror({ ...env, GOOGLE_SERVICE_ACCOUNT: '{"type":"authorized_user"}' }, { fetch: fakeGoogle().fetchFn, now: () => NOW })).rejects.toThrow('missing client_email')
  })
})
