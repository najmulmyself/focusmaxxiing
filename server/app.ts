import { AuthError, allowedEmails, authenticate, createSession, endSession, googleJwks, verifyGoogleIdToken, type JwksSource } from './auth'
import type { Env } from './d1'
import { SyncError, pull, push, validate } from './sync'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

const MAX_BODY = 4_000_000

async function body<T>(req: Request): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BODY) throw new SyncError('Request too large', 413)
  const text = await req.text()
  if (text.length > MAX_BODY) throw new SyncError('Request too large', 413)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SyncError('Expected JSON')
  }
}

const isLocal = (url: URL) => ['localhost', '127.0.0.1'].includes(url.hostname)

/** All /api routes. Everything except config and sign-in requires a session. */
export async function handle(req: Request, env: Env, deps: { jwks?: JwksSource; now?: () => number } = {}): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '')
  const now = deps.now?.() ?? Date.now()
  const configured = !!env.GOOGLE_CLIENT_ID && allowedEmails(env.ALLOWED_EMAILS).length > 0
  const devAuth = env.DEV_AUTH === '1' && isLocal(url)

  try {
    if (path === '/api/config' && req.method === 'GET') {
      return json({ sync: configured || devAuth, googleClientId: env.GOOGLE_CLIENT_ID || null, devAuth })
    }

    if (path === '/api/auth/google' && req.method === 'POST') {
      if (!configured) return json({ error: 'Sync is not set up on the server yet.' }, 503)
      const { credential } = await body<{ credential?: string }>(req)
      if (!credential) throw new AuthError('Missing Google credential', 400)
      const claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID!, deps.jwks ?? googleJwks, now)
      const email = claims.email.toLowerCase()
      if (!allowedEmails(env.ALLOWED_EMAILS).includes(email)) throw new AuthError(`${claims.email} isn't allowed to sync with this app.`, 403)
      const token = await createSession(env.DB, email, req.headers.get('user-agent') ?? '', now)
      return json({ token, email })
    }

    if (path === '/api/auth/dev' && req.method === 'POST') {
      if (!devAuth) return json({ error: 'Not found' }, 404)
      const { email } = await body<{ email?: string }>(req)
      if (!email) throw new AuthError('Missing email', 400)
      const token = await createSession(env.DB, email.toLowerCase(), 'dev', now)
      return json({ token, email: email.toLowerCase() })
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      await endSession(env.DB, req.headers.get('authorization'))
      return json({ ok: true })
    }

    if (path === '/api/sync/push' && req.method === 'POST') {
      const user = await authenticate(env.DB, req.headers.get('authorization'), now)
      const { records } = await body<{ records?: unknown }>(req)
      return json(await push(env.DB, user, validate(records)))
    }

    if (path === '/api/sync/pull' && req.method === 'GET') {
      const user = await authenticate(env.DB, req.headers.get('authorization'), now)
      const since = Math.max(0, Math.floor(Number(url.searchParams.get('since') ?? 0)) || 0)
      return json(await pull(env.DB, user, since))
    }

    if (path === '/api/me' && req.method === 'GET') {
      return json({ email: await authenticate(env.DB, req.headers.get('authorization'), now) })
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    if (e instanceof AuthError || e instanceof SyncError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Something went wrong on the server. Your data is safe on this device; sync will retry.' }, 500)
  }
}
