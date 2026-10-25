import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import type { D1Like, D1Stmt } from './d1'

/** D1-compatible wrapper over Node's built-in SQLite, for tests. */
export function memoryD1(): D1Like {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('./migrations/0001_init.sql', import.meta.url), 'utf8'))
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
