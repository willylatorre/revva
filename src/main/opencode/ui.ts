/**
 * The OpenCode web interface, embedded inside Revva.
 *
 * OpenCode V2 serves its own UI from the same origin as the API. That UI
 * authenticates with a session cookie, not the basic-auth header the API
 * client uses, so this module asks the running service for a one-time pairing
 * code and redeems it inside a dedicated Electron session. Pairing is done
 * once per endpoint; the cookie jar then serves every webview.
 *
 * The partition is in-memory (`revva-opencode-ui`, no `persist:` prefix), so
 * the cookie never reaches disk. A restarted service signs cookies with a new
 * secret, so a cheap authenticated request detects a stale cookie and a fresh
 * pairing code replaces it.
 */
import { session } from 'electron'
import type { OpenCodeUiTarget } from '@shared/types'
import { openCodeService, describeError } from './service'

/** In-memory partition shared by every embedded OpenCode view. */
const PARTITION = 'revva-opencode-ui'

interface Pairing {
  url: string
  /** Base URL the SPA routes session links from. */
  base: string
}

let paired: Pairing | undefined
/** A pairing in flight, so several webviews mounting at once share one code. */
let pending: Promise<Pairing> | undefined

/**
 * The cookie name is derived from the service port (`opencode_session_<port>`),
 * so pairing only carries over while the origin is unchanged. Compare origins,
 * not the full URL: a trailing slash is the same server.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Redeem a one-time pairing code so the webview's session holds the auth
 * cookie. `ses.fetch` shares the cookie jar with the webview, which is why the
 * `Set-Cookie` from the redirect lands where the page needs it.
 */
async function pair(url: string): Promise<Pairing> {
  const ses = session.fromPartition(PARTITION)
  // The pairing endpoint requires the same basic auth as every other API call.
  const res = await ses.fetch(new URL('/api/pair', url).toString(), {
    method: 'POST',
    credentials: 'include',
    headers: openCodeService.authHeaders(),
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`OpenCode did not issue a pairing code (HTTP ${res.status}).`)
  const body = (await res.json()) as { code?: unknown }
  const code = typeof body.code === 'string' ? body.code : ''
  if (!code) throw new Error('OpenCode returned no pairing code.')
  // A browser-style request asks the endpoint for a redirect instead of JSON;
  // following it stores the cookie in this session.
  const connected = await ses.fetch(new URL(`/auth/connect/${encodeURIComponent(code)}`, url).toString(), {
    credentials: 'include',
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!connected.ok) throw new Error(`OpenCode refused the pairing code (HTTP ${connected.status}).`)
  const cookies = await ses.cookies.get({ url })
  if (cookies.length === 0) throw new Error('OpenCode accepted the pairing code but set no session cookie.')
  // The SPA's route key is the base64url form of the server URL.
  return { url, base: `${url}/server/${Buffer.from(url).toString('base64url')}` }
}

/** True while the stored cookie still authenticates against this endpoint. */
async function cookieWorks(url: string): Promise<boolean> {
  try {
    const res = await session.fromPartition(PARTITION).fetch(new URL('/api/info', url).toString(), {
      credentials: 'include',
      signal: AbortSignal.timeout(4000)
    })
    return res.ok
  } catch {
    return false
  }
}

/** The paired web UI for the current endpoint, pairing (again) when needed. */
async function ensurePairing(url: string): Promise<Pairing> {
  if (paired && originOf(paired.url) === originOf(url) && (await cookieWorks(url))) return paired
  paired = undefined
  const current = pending
  if (current) {
    // A failed pairing must not poison this attempt; just pair again.
    const shared = await current.catch(() => undefined)
    if (shared && originOf(shared.url) === originOf(url)) return shared
  }
  const work = pair(url)
  pending = work
  try {
    paired = await work
    return paired
  } finally {
    if (pending === work) pending = undefined
  }
}

/**
 * Resolve the embedded UI for a conversation. Throws a readable error when
 * the service is not connected or refuses to pair, so the caller shows a
 * retryable message instead of an empty panel.
 */
export async function openCodeUiFor(sessionId: string): Promise<OpenCodeUiTarget> {
  if (!openCodeService.connected) throw new Error('The OpenCode service is not connected yet.')
  const url = openCodeService.getStatus().url
  if (!url) throw new Error('The OpenCode service has no address yet.')
  try {
    const pairing = await ensurePairing(url)
    return { url: `${pairing.base}/session/${encodeURIComponent(sessionId)}`, partition: PARTITION }
  } catch (error) {
    // Forget the pairing so the next attempt starts clean.
    paired = undefined
    throw new Error(`Could not open the OpenCode interface: ${describeError(error)}`)
  }
}
