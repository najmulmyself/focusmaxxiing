/* Google Sheets over REST with a service account: no SDK, just WebCrypto and fetch. */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

export class SheetsError extends Error {}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s))

export function parseServiceAccount(raw: string): ServiceAccount {
  let sa: Partial<ServiceAccount>
  try {
    sa = JSON.parse(raw)
  } catch {
    throw new SheetsError('GOOGLE_SERVICE_ACCOUNT is not valid JSON. Paste the whole key file from Google Cloud.')
  }
  if (!sa.client_email || !sa.private_key) throw new SheetsError('GOOGLE_SERVICE_ACCOUNT is missing client_email or private_key.')
  return sa as ServiceAccount
}

async function signingKey(pem: string) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n|\s/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/** Exchange a signed JWT for an hour-long access token (OAuth 2.0 JWT bearer grant). */
export async function accessToken(sa: ServiceAccount, fetchFn: Fetch, now = Date.now()): Promise<string> {
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const iat = Math.floor(now / 1000)
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }))}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(unsigned))
  const res = await fetchFn(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(new Uint8Array(sig))}` }).toString(),
  })
  const out = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string }
  if (!res.ok || !out.access_token) throw new SheetsError(`Google refused the service account key (${res.status}): ${out.error_description ?? out.error ?? 'no detail'}`)
  return out.access_token
}

export interface SheetProps {
  sheetId: number
  title: string
  gridProperties?: { rowCount?: number; columnCount?: number }
}
export interface SpreadsheetMeta {
  properties: { title: string; timeZone: string }
  sheets: { properties: SheetProps }[]
}

/** The three calls the mirror needs. Errors say what to fix. */
export function sheetsClient(spreadsheetId: string, token: string, sa: ServiceAccount, fetchFn: Fetch) {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchFn(`${API}/${encodeURIComponent(spreadsheetId)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    if (res.ok) return (await res.json()) as T
    const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? ''
    if (res.status === 403) throw new SheetsError(`No access to the sheet. Share it with ${sa.client_email} as an editor. (${detail})`)
    if (res.status === 404) throw new SheetsError(`Sheet ${spreadsheetId} not found. Check SHEET_ID. (${detail})`)
    throw new SheetsError(`Google Sheets error ${res.status}: ${detail}`)
  }
  return {
    meta: () => call<SpreadsheetMeta>('?fields=properties(title,timeZone),sheets.properties(sheetId,title,gridProperties)'),
    batchUpdate: (requests: unknown[]) => call<unknown>(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }),
    writeValues: (data: { range: string; values: unknown[][] }[]) =>
      // RAW: nothing a user typed is ever parsed as a formula
      call<unknown>('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }),
  }
}
