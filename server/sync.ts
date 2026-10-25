import type { D1Like } from './d1'

export const KINDS = ['session', 'task', 'project', 'template', 'settings'] as const
export type Kind = (typeof KINDS)[number]

export interface WireRecord {
  kind: Kind
  id: string
  /** the record's own modified time (ms); newest wins */
  version: number
  data: unknown
}

export const LIMITS = { pushRecords: 500, recordBytes: 64_000, pullPage: 500 }

export class SyncError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export function validate(records: unknown): WireRecord[] {
  if (!Array.isArray(records)) throw new SyncError('Expected a list of records')
  if (records.length > LIMITS.pushRecords) throw new SyncError(`Send at most ${LIMITS.pushRecords} records at a time`)
  return records.map((r, i) => {
    const x = r as Partial<WireRecord>
    if (!x || !KINDS.includes(x.kind as Kind)) throw new SyncError(`Record ${i + 1}: unknown kind`)
    if (typeof x.id !== 'string' || !x.id || x.id.length > 120) throw new SyncError(`Record ${i + 1}: bad id`)
    if (typeof x.version !== 'number' || !Number.isFinite(x.version) || x.version < 0) throw new SyncError(`Record ${i + 1}: bad version`)
    if (!x.data || typeof x.data !== 'object') throw new SyncError(`Record ${i + 1}: missing data`)
    const json = JSON.stringify(x.data)
    if (json.length > LIMITS.recordBytes) throw new SyncError(`Record ${i + 1}: too large`)
    return { kind: x.kind as Kind, id: x.id, version: Math.floor(x.version), data: x.data }
  })
}

/**
 * Store records, keeping whichever version is newer. Runs as one D1 batch, which
 * is a single transaction: the counter bump and every upsert land together, so
 * change numbers are unique and increase in commit order.
 */
export async function push(db: D1Like, user: string, records: WireRecord[]) {
  if (!records.length) return { accepted: 0, seq: await currentSeq(db, user) }
  const n = records.length
  const stmts = [
    db.prepare('INSERT INTO counters (user_id, seq) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET seq = seq + ?').bind(user, n, n),
    ...records.map((r, i) =>
      db
        .prepare(
          `INSERT INTO records (user_id, kind, id, version, seq, data)
           VALUES (?, ?, ?, ?, (SELECT seq FROM counters WHERE user_id = ?) - ?, ?)
           ON CONFLICT (user_id, kind, id) DO UPDATE SET version = excluded.version, seq = excluded.seq, data = excluded.data
           WHERE excluded.version > records.version`,
        )
        .bind(user, r.kind, r.id, r.version, user, n - 1 - i, JSON.stringify(r.data)),
    ),
  ]
  await db.batch(stmts)
  return { seq: await currentSeq(db, user) }
}

async function currentSeq(db: D1Like, user: string) {
  return (await db.prepare('SELECT seq FROM counters WHERE user_id = ?').bind(user).first<{ seq: number }>())?.seq ?? 0
}

/** Changes after `since`, oldest first. `more` means call again with `next`. */
export async function pull(db: D1Like, user: string, since: number) {
  const { results } = await db
    .prepare('SELECT kind, id, version, seq, data FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(user, since, LIMITS.pullPage + 1)
    .all<{ kind: Kind; id: string; version: number; seq: number; data: string }>()
  const more = results.length > LIMITS.pullPage
  const page = results.slice(0, LIMITS.pullPage)
  return {
    records: page.map((r) => ({ kind: r.kind, id: r.id, version: r.version, data: JSON.parse(r.data) })),
    next: page.length ? page[page.length - 1].seq : since,
    more,
  }
}
