import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getStatus, signInDev, signInWithGoogle, signOut, subscribe, syncNow, type SyncStatus } from './engine'

export const useSync = (): SyncStatus => useSyncExternalStore(subscribe, getStatus)

export const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

interface GoogleId {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean }): void
      renderButton(el: HTMLElement, o: Record<string, unknown>): void
    }
  }
}

let gsi: Promise<GoogleId> | null = null
function loadGsi(): Promise<GoogleId> {
  return (gsi ??= new Promise((resolve, reject) => {
    const w = window as unknown as { google?: GoogleId }
    if (w.google?.accounts) return resolve(w.google)
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google sign-in did not load')))
    s.onerror = () => {
      gsi = null
      reject(new Error('Could not reach Google sign-in. Check your connection.'))
    }
    document.head.appendChild(s)
  }))
}

function GoogleButton({ clientId, onError }: { clientId: string; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    loadGsi()
      .then((g) => {
        if (!live || !ref.current) return
        g.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => void signInWithGoogle(credential).catch((e: Error) => onError(e.message)),
        })
        g.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' })
      })
      .catch((e: Error) => onError(e.message))
    return () => {
      live = false
    }
  }, [clientId, onError])
  return <div ref={ref} className="min-h-10" />
}

/** Settings → Sync: sign in, see what's synced, sync now, sign out. */
export function SyncPanel() {
  const s = useSync()
  const [err, setErr] = useState<string | null>(null)
  const [devEmail, setDevEmail] = useState('me@example.com')
  const error = err ?? s.error

  if (s.phase === 'loading') return <p className="text-sm text-muted">Checking sync…</p>
  if (s.phase === 'unavailable')
    return (
      <p className="text-sm text-muted">
        Sync isn&rsquo;t available here yet, so everything stays on this device. Use backups to move data between browsers.
      </p>
    )

  if (s.phase === 'signed-out' || !s.email)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Sign in to keep your sessions, tasks and settings in sync across devices, with a copy safely in the cloud. This device keeps working offline.
          {s.pending > 0 && <> <b className="text-fg">{s.pending} items</b> here will upload when you sign in.</>}
        </p>
        {s.googleClientId && <GoogleButton clientId={s.googleClientId} onError={setErr} />}
        {s.devAuth && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setErr(null)
              void signInDev(devEmail).catch((x: Error) => setErr(x.message))
            }}
          >
            <label htmlFor="dev-email" className="sr-only">Email (local development)</label>
            <input id="dev-email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} className="min-w-0 flex-1 rounded-lg border-2 border-line bg-bg px-3 py-1.5 text-sm" />
            <button className="btn px-3 text-sm">Sign in (dev)</button>
          </form>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-[var(--vermilion)]">{error}</p>}
      </div>
    )

  const line =
    s.phase === 'syncing' ? 'Syncing…' :
    s.phase === 'offline' ? `Offline. ${s.pending ? `${s.pending} changes will sync when you're back online.` : 'Everything is saved on this device.'}` :
    s.phase === 'error' ? 'Sync hit a problem and will retry.' :
    s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}${s.pending ? ` · ${s.pending} waiting` : ''}` : 'Ready'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Signed in as {s.email}</div>
          <div className="text-sm text-muted" role="status">{line}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5 text-sm" onClick={() => void syncNow()} disabled={s.phase === 'syncing'}>Sync now</button>
          <button className="btn px-3 py-1.5 text-sm" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-[var(--vermilion)]">{error}</p>}
      <p className="text-xs text-muted">Signing out keeps everything on this device; it just stops syncing.</p>
    </div>
  )
}
