import { beforeEach, describe, expect, it } from 'vitest'
import { handle } from './app'
import type { Jwk } from './auth'
import type { Env } from './d1'
import { memoryD1 } from './testdb'

const CLIENT = 'test-client.apps.googleusercontent.com'
const NOW = Date.UTC(2026, 9, 25, 12)

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url')

let keys: CryptoKeyPair
let jwk: Jwk
async function googleToken(claims: Record<string, unknown>, kid = 'k1', signer = keys.privateKey) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1', email: 'me@example.com', email_verified: true, iat: NOW / 1000, exp: NOW / 1000 + 3600, ...claims }),
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(sig)}`
}

let env: Env
const call = (method: string, path: string, opts: { body?: unknown; token?: string; host?: string } = {}) =>
  handle(
    new Request(`https://${opts.host ?? 'focusmaxxiing.pages.dev'}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
    { jwks: async () => [jwk], now: () => NOW },
  )

async function signIn(email = 'me@example.com') {
  const res = await call('POST', '/api/auth/google', { body: { credential: await googleToken({ email }) } })
  return (await res.json()) as { token: string; email: string; error?: string }
}

const rec = (id: string, version: number, data: Record<string, unknown> = {}, kind = 'session') => ({ kind, id, version, data: { id, ...data } })

beforeEach(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' } as Jwk
  env = { DB: memoryD1(), GOOGLE_CLIENT_ID: CLIENT, ALLOWED_EMAILS: 'me@example.com' }
})

describe('config', () => {
  it('reports sync off until the server is configured', async () => {
    env.GOOGLE_CLIENT_ID = ''
    expect(await (await call('GET', '/api/config')).json()).toEqual({ sync: false, googleClientId: null, devAuth: false })
    expect((await call('POST', '/api/auth/google', { body: { credential: 'x' } })).status).toBe(503)
  })
})

describe('sign-in', () => {
  it('accepts a valid Google token for an allowed email', async () => {
    const r = await signIn()
    expect(r.email).toBe('me@example.com')
    expect(r.token).toMatch(/^[0-9a-f]{64}$/)
    expect(await (await call('GET', '/api/me', { token: r.token })).json()).toEqual({ email: 'me@example.com' })
  })

  it('rejects other emails, other apps, expired and forged tokens', async () => {
    const expect403 = async (claims: Record<string, unknown>, status: number, msg: RegExp) => {
      const res = await call('POST', '/api/auth/google', { body: { credential: await googleToken(claims) } })
      expect(res.status).toBe(status)
      expect(((await res.json()) as { error: string }).error).toMatch(msg)
    }
    await expect403({ email: 'someone@else.com' }, 403, /isn't allowed/)
    await expect403({ aud: 'other-app' }, 401, /different app/)
    await expect403({ exp: NOW / 1000 - 3600 }, 401, /expired/)
    await expect403({ email_verified: false }, 401, /not verified/)
    await expect403({ iss: 'https://evil.example' }, 401, /not issued by Google/)
    const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const forged = await googleToken({}, 'k1', other.privateKey)
    expect((await call('POST', '/api/auth/google', { body: { credential: forged } })).status).toBe(401)
  })

  it('refuses sync without a valid session, and after logout', async () => {
    expect((await call('GET', '/api/sync/pull')).status).toBe(401)
    expect((await call('GET', '/api/sync/pull', { token: 'a'.repeat(64) })).status).toBe(401)
    const { token } = await signIn()
    await call('POST', '/api/auth/logout', { token })
    expect((await call('GET', '/api/sync/pull', { token })).status).toBe(401)
  })

  it('only allows dev sign-in locally when explicitly enabled', async () => {
    expect((await call('POST', '/api/auth/dev', { body: { email: 'x@y.z' } })).status).toBe(404)
    env.DEV_AUTH = '1'
    expect((await call('POST', '/api/auth/dev', { body: { email: 'x@y.z' } })).status).toBe(404) // not localhost
    expect((await call('POST', '/api/auth/dev', { body: { email: 'x@y.z' }, host: 'localhost:8788' })).status).toBe(200)
  })
})

describe('sync', () => {
  it('pushes, pulls in order, and pages through changes', async () => {
    const { token } = await signIn()
    await call('POST', '/api/sync/push', { token, body: { records: [rec('a', 1), rec('b', 1), rec('t', 1, {}, 'task')] } })
    await call('POST', '/api/sync/push', { token, body: { records: [rec('c', 1)] } })
    const p = (await (await call('GET', '/api/sync/pull?since=0', { token })).json()) as { records: { id: string }[]; next: number; more: boolean }
    expect(p.records.map((r) => r.id)).toEqual(['a', 'b', 't', 'c'])
    expect(p.next).toBe(4)
    const again = (await (await call('GET', `/api/sync/pull?since=${p.next}`, { token })).json()) as { records: unknown[] }
    expect(again.records).toEqual([])
  })

  it('keeps the newest version and re-sequences updates', async () => {
    const { token } = await signIn()
    await call('POST', '/api/sync/push', { token, body: { records: [rec('a', 10, { note: 'v10' })] } })
    await call('POST', '/api/sync/push', { token, body: { records: [rec('a', 5, { note: 'stale' })] } })
    let p = (await (await call('GET', '/api/sync/pull?since=0', { token })).json()) as { records: { data: { note: string } }[]; next: number }
    expect(p.records[0].data.note).toBe('v10')
    const before = p.next
    await call('POST', '/api/sync/push', { token, body: { records: [rec('a', 20, { note: 'v20' })] } })
    p = (await (await call('GET', `/api/sync/pull?since=${before}`, { token })).json()) as { records: { data: { note: string } }[]; next: number }
    expect(p.records.map((r) => r.data.note)).toEqual(['v20'])
  })

  it('keeps users apart', async () => {
    env.ALLOWED_EMAILS = 'me@example.com, you@example.com'
    const me = await signIn('me@example.com')
    const you = await signIn('you@example.com')
    await call('POST', '/api/sync/push', { token: me.token, body: { records: [rec('mine', 1)] } })
    const p = (await (await call('GET', '/api/sync/pull?since=0', { token: you.token })).json()) as { records: unknown[] }
    expect(p.records).toEqual([])
  })

  it('validates what it stores', async () => {
    const { token } = await signIn()
    const bad = async (records: unknown, msg: RegExp) => {
      const res = await call('POST', '/api/sync/push', { token, body: { records } })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(msg)
    }
    await bad([{ kind: 'secret', id: 'x', version: 1, data: {} }], /unknown kind/)
    await bad([{ kind: 'task', id: '', version: 1, data: {} }], /bad id/)
    await bad([{ kind: 'task', id: 'x', version: 'new', data: {} }], /bad version/)
    await bad(Array.from({ length: 501 }, (_, i) => rec(`r${i}`, 1)), /at most 500/)
    await bad([rec('big', 1, { note: 'x'.repeat(70_000) })], /too large/)
  })
})
