import type { D1Like } from './d1'

/* Google ID token verification (RS256 JWT) with WebCrypto, plus our own session tokens. */

export interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}
export type JwksSource = () => Promise<Jwk[]>

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

let cache: { keys: Jwk[]; until: number } | null = null
export const googleJwks: JwksSource = async () => {
  if (cache && cache.until > Date.now()) return cache.keys
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  if (!res.ok) throw new Error(`Could not fetch Google keys (${res.status})`)
  const { keys } = (await res.json()) as { keys: Jwk[] }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600)
  cache = { keys, until: Date.now() + maxAge * 1000 }
  return keys
}

const b64urlBytes = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const b64urlJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlBytes(s)))

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message)
  }
}

export interface GoogleClaims {
  iss: string
  aud: string
  sub: string
  email: string
  email_verified: boolean
  exp: number
  iat: number
  name?: string
}

/** Verify signature, issuer, audience, expiry and a verified email. */
export async function verifyGoogleIdToken(token: string, clientId: string, jwks: JwksSource, now = Date.now()): Promise<GoogleClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('Malformed sign-in token')
  const header = b64urlJson<{ alg: string; kid: string }>(parts[0])
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm')
  const jwk = (await jwks()).find((k) => k.kid === header.kid)
  if (!jwk) throw new AuthError('Unknown signing key')
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) throw new AuthError('Invalid token signature')
  const c = b64urlJson<GoogleClaims>(parts[1])
  if (!GOOGLE_ISSUERS.includes(c.iss)) throw new AuthError('Token not issued by Google')
  if (c.aud !== clientId) throw new AuthError('Token was issued for a different app')
  if (c.exp * 1000 < now - 60_000) throw new AuthError('Sign-in token expired, try again')
  if (!c.email || !c.email_verified) throw new AuthError('Google account email is not verified')
  return c
}

export const allowedEmails = (raw?: string) =>
  (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const SESSION_DAYS = 365

export async function createSession(db: D1Like, email: string, userAgent: string, now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  await db
    .prepare('INSERT INTO auth_sessions (token_hash, email, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), email, now, now, now + SESSION_DAYS * 86_400_000, userAgent.slice(0, 200))
    .run()
  return token
}

/** Resolve a Bearer token to an email, sliding its last-seen time. */
export async function authenticate(db: D1Like, header: string | null, now = Date.now()): Promise<string> {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) throw new AuthError('Sign in to sync')
  const hash = await sha256(token)
  const row = await db.prepare('SELECT email, expires_at, last_seen FROM auth_sessions WHERE token_hash = ?').bind(hash).first<{ email: string; expires_at: number; last_seen: number }>()
  if (!row || row.expires_at < now) throw new AuthError('Your sign-in expired. Sign in again to keep syncing.')
  // write at most once an hour
  if (now - row.last_seen > 3_600_000) await db.prepare('UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?').bind(now, hash).run()
  return row.email
}

export async function endSession(db: D1Like, header: string | null) {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run()
}
