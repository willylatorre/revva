/**
 * Atlassian MCP OAuth owned by Revva (REQ: no dependence on another app's token cache).
 *
 * MCP v2 is a **separate OAuth resource** from v1: the v1 access/refresh token and the v1
 * dynamic client registration do not work against it, so upgrading means one fresh consent
 * (https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-mcp-v1-to-atlassian-mcp-v2/).
 * v2 also publishes its authorization server behind an opaque, rotatable path
 * (`https://auth.atlassian.com/<opaque>`), so nothing here hardcodes an authorize/token/register
 * URL: they are discovered from the resource metadata at connect time and persisted with the
 * client registration.
 *
 * Verified 2026-10-30 against https://mcp.atlassian.com/v2/mcp:
 *  - unauthenticated POST → 401 with `WWW-Authenticate: ... oauth-protected-resource/v2/mcp`
 *  - that metadata names the authorization server; its OAuth metadata offers dynamic client
 *    registration with token_endpoint_auth_method "none" (public client, PKCE, S256 only)
 *  - scopes are the `*:jira:agent-interface` set, not v1's `read:jira-work` etc.
 *
 * Flow: discover endpoints → loopback listener on a random port → DCR bound to that redirect_uri
 * → system-browser authorize w/ PKCE → token exchange → tokens in Electron safeStorage
 * (OS keychain-backed). Refresh tokens extend silently.
 */
import { app, safeStorage, shell } from 'electron'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'

export const MCP_ENDPOINT = 'https://mcp.atlassian.com/v2/mcp'
/** v2 defaults to a `discover`/`execute` surface; `?tools=all` gives the flat tools/list we map capabilities onto. */
export const MCP_URL = `${MCP_ENDPOINT}?tools=all`
const PROTECTED_RESOURCE = 'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp'
/** Requested scopes, all from the resource metadata's `scopes_supported` (least privilege for the board + ship + watcher). */
const SCOPE =
  'read:me read:account search:jira:agent-interface read:jira:agent-interface write:jira:agent-interface offline_access'
const CONNECT_TIMEOUT_MS = 300_000

type Tokens = { access_token: string; refresh_token?: string; expires_at: number; resource?: string }
type ClientReg = { client_id: string; client_secret?: string; redirect_uri: string }

/** OAuth endpoints for the MCP v2 resource, discovered rather than hardcoded. */
type OAuthEndpoints = { authorize: string; token: string; register: string }
/** The v2 on-disk client file carries its endpoints; v1-era files do not, and are discarded on load. */
type StoredClient = ClientReg & OAuthEndpoints

export type JiraAuthStatus = { connected: boolean; expired: boolean; expiresAt?: number }

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

async function fetchJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

/**
 * Resource metadata → authorization server → its OAuth metadata. Atlassian's issuer carries a
 * path segment, so RFC 8414 §3.1 allows two well-known forms; try both before giving up.
 */
async function discoverEndpoints(): Promise<OAuthEndpoints> {
  const prm = await fetchJson<{ authorization_servers?: string[] }>(
    PROTECTED_RESOURCE,
    'Atlassian MCP resource metadata'
  )
  const as = prm.authorization_servers?.[0]
  if (!as) throw new Error('Atlassian MCP v2 did not name an authorization server.')
  const url = new URL(as)
  const candidates = [
    `${as.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    `${url.origin}/.well-known/oauth-authorization-server${url.pathname.replace(/\/$/, '')}`
  ]
  for (const candidate of candidates) {
    let meta: Record<string, unknown>
    try {
      meta = (await fetchJson<Record<string, unknown>>(candidate, 'Atlassian OAuth metadata')) as Record<string, unknown>
    } catch {
      continue
    }
    const { authorization_endpoint: authorize, token_endpoint: token, registration_endpoint: register } = meta
    if (typeof authorize === 'string' && typeof token === 'string' && typeof register === 'string') {
      return { authorize, token, register }
    }
  }
  throw new Error(`Could not find Atlassian's OAuth endpoints for ${as}.`)
}

class JiraAuth {
  private tokens: Tokens | undefined
  private client: ClientReg | undefined
  private endpoints: OAuthEndpoints | undefined

  private get secretsDir(): string {
    return join(app.getPath('userData'), 'secrets')
  }
  private get storePath(): string {
    return join(this.secretsDir, 'atlassian.bin')
  }
  private get clientPath(): string {
    return join(this.secretsDir, 'atlassian-client.json')
  }

  async load(): Promise<void> {
    try {
      if (existsSync(this.clientPath)) {
        const stored = JSON.parse(readFileSync(this.clientPath, 'utf8')) as Partial<StoredClient>
        // A registration minted by another authorization server (v1's, or a rotated v2 one)
        // cannot produce v2 tokens, so require the endpoints it was minted against.
        if (
          stored.client_id &&
          stored.redirect_uri &&
          stored.authorize &&
          stored.token &&
          stored.register
        ) {
          this.client = {
            client_id: stored.client_id,
            client_secret: stored.client_secret,
            redirect_uri: stored.redirect_uri
          }
          this.endpoints = { authorize: stored.authorize, token: stored.token, register: stored.register }
        }
      }
      if (existsSync(this.storePath) && (await safeStorage.isAsyncEncryptionAvailable())) {
        const bytes = readFileSync(this.storePath)
        const dec = await safeStorage.decryptStringAsync(bytes)
        // Key rotation: the docs say to decrypt once more to receive the string
        // under the new key; the second call performs the re-wrap.
        const json = dec.shouldReEncrypt ? (await safeStorage.decryptStringAsync(bytes)).result : dec.result
        const stored = json ? (JSON.parse(json) as Tokens) : undefined
        // Tokens minted for the v1 resource are not refreshable against v2; treating them as
        // absent is what surfaces "Connect Jira" in Setup instead of a 401 on first board fetch.
        this.tokens = stored?.resource === MCP_ENDPOINT ? stored : undefined
      }
    } catch {
      this.tokens = undefined
    }
  }

  private async persist(): Promise<void> {
    mkdirSync(this.secretsDir, { recursive: true })
    if (this.client && this.endpoints) {
      writeFileSync(this.clientPath, JSON.stringify({ ...this.client, ...this.endpoints } satisfies StoredClient))
    }
    if (this.tokens && (await safeStorage.isAsyncEncryptionAvailable())) {
      writeFileSync(this.storePath, await safeStorage.encryptStringAsync(JSON.stringify(this.tokens)))
    }
  }

  status(): JiraAuthStatus {
    if (!this.tokens) return { connected: false, expired: false }
    const live = Date.now() < this.tokens.expires_at - 30_000
    return { connected: live, expired: !live, expiresAt: this.tokens.expires_at }
  }

  /** Access token, refreshed when close to expiry. Throws when not connected. */
  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error('Jira is not connected. Connect it in Setup.')
    if (Date.now() > this.tokens.expires_at - 60_000 && this.tokens.refresh_token) {
      await this.refresh()
    }
    if (!this.tokens || Date.now() > this.tokens.expires_at) {
      throw new Error('Jira session expired — reconnect in Setup.')
    }
    return this.tokens.access_token
  }

  /** Opens the system browser for consent; waits on a loopback redirect (5-min budget). */
  async connect(): Promise<void> {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = randomUUID()

    // 1. Endpoints for the v2 resource (cached on disk after the first success).
    this.endpoints = await discoverEndpoints()

    // 2. Loopback listener on a random free port.
    const { server, port, codePromise } = await startListener(state)
    const redirectUri = `http://127.0.0.1:${port}/callback`

    try {
      // 3. Register a client bound to this exact redirect (cheap; also refreshes stale ones).
      const res = await fetch(this.endpoints.register, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Revva',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        })
      })
      if (!res.ok) throw new Error(`Atlassian client registration failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as ClientReg
      this.client = { client_id: data.client_id, client_secret: data.client_secret, redirect_uri: redirectUri }

      // 4. Authorize in the system browser.
      const authUrl = new URL(this.endpoints.authorize)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', this.client.client_id)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('scope', SCOPE)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      await shell.openExternal(authUrl.toString())

      // 5. Wait for the redirect.
      const code = await Promise.race([
        codePromise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Jira sign-in timed out (5 minutes).')), CONNECT_TIMEOUT_MS)
        )
      ])

      // 6. Exchange.
      this.tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
      await this.persist()
    } finally {
      server.close()
    }
  }

  async refresh(): Promise<void> {
    if (!this.tokens?.refresh_token || !this.client) throw new Error('Nothing to refresh — reconnect Jira.')
    try {
      this.tokens = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token
      })
      await this.persist()
    } catch (err) {
      this.tokens = undefined
      await this.persist()
      throw err
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<Tokens> {
    if (!this.client) throw new Error('No Atlassian client registered.')
    // A refresh can run long after connect, when the in-memory endpoints are gone.
    this.endpoints ??= await discoverEndpoints()
    const body = new URLSearchParams({ ...params, client_id: this.client.client_id })
    if (this.client.client_secret) body.set('client_secret', this.client.client_secret)
    const res = await fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) throw new Error(`Atlassian token error ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.tokens?.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      // Which MCP resource these tokens were minted for; anything else is treated as absent.
      resource: MCP_ENDPOINT
    }
  }

  async disconnect(): Promise<void> {
    this.tokens = undefined
    mkdirSync(this.secretsDir, { recursive: true })
    writeFileSync(this.storePath, '')
  }
}

function startListener(state: string): Promise<{ server: Server; port: number; codePromise: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let deliver: (code: string) => void = () => undefined
    let fail: (err: Error) => void = () => undefined
    const codePromise = new Promise<string>((res, rej) => {
      deliver = res
      fail = rej
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') return void res.writeHead(404).end()
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      if (err || !code || url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<h3>Revva sign-in failed.</h3>You can close this tab.')
        fail(new Error(err ?? 'missing code/state'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h3>Revva is connected to Jira.</h3>You can close this tab and return to Revva.')
      deliver(code)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, codePromise })
    })
  })
}

export const jiraAuth = new JiraAuth()
