/** The slice of Cloudflare's D1 API the server uses, so tests can supply an in-memory SQLite. */
export interface D1Result<T = Record<string, unknown>> {
  results: T[]
}
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}
export interface D1Like {
  prepare(sql: string): D1Stmt
  /** Runs all statements in one transaction. */
  batch(stmts: D1Stmt[]): Promise<unknown[]>
}

export interface Env {
  DB: D1Like
  /** OAuth client id from Google Cloud; sync stays off until it's set */
  GOOGLE_CLIENT_ID?: string
  /** comma-separated emails allowed to sign in */
  ALLOWED_EMAILS?: string
  /** local development only: enables /api/auth/dev */
  DEV_AUTH?: string
}
