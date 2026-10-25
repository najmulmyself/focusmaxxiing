import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import type { D1Like, D1Stmt } from './d1'

/** D1-compatible wrapper over Node's built-in SQLite, for tests. */
export function memoryD1(): D1Like {
  const db = new DatabaseSync(':memory:')
  const dir = new URL('./migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
  const stmt = (sql: string, values: unknown[] = []): D1Stmt & { exec(): void } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T,>() => (db.prepare(sql).get(...(values as never[])) as T) ?? null,
    all: async <T,>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(values as never[])),
    exec: () => void db.prepare(sql).run(...(values as never[])),
  })
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN')
      try {
        for (const s of stmts) (s as ReturnType<typeof stmt>).exec()
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return []
    },
  }
}
