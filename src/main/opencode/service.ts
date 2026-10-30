/**
 * OpenCode local service attachment.
 *
 * `Service.ensure()` discovers a healthy local OpenCode service (registration file) or starts
 * one via `opencode serve --service`. We never rewrite the user's OpenCode config; we only
 * connect over HTTP with the advertised basic-auth headers.
 */
import { Service, type Endpoint } from '@opencode/client/service'
import { OpenCode } from '@opencode/client'
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ServiceStatus } from '@shared/types'
import { pushToWindows } from '../push'

const execFileAsync = promisify(execFile)

type Listener = (status: ServiceStatus) => void

let windowsCommand: Promise<string[] | undefined> | undefined

/**
 * npm-installed `opencode` on Windows is an `opencode.cmd` shim, and Node refuses
 * to spawn `.cmd`/`.bat` without a shell (CVE-2024-27980) — the bare
 * `spawn('opencode', …)` in @opencode/client then dies with EINVAL even though
 * opencode IS installed. Resolve `opencode` on PATH once: a native `.exe` spawns
 * directly; a `.cmd`/`.bat` shim is wrapped in cmd.exe. Nothing found keeps the
 * default behavior so the friendly "install it" hint still surfaces.
 */
function windowsServiceCommand(): Promise<string[] | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  windowsCommand ??= (async () => {
    try {
      const { stdout } = await execFileAsync('where.exe', ['opencode'], { windowsHide: true, timeout: 10_000 })
      const found = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const exe = found.find((p) => /\.exe$/i.test(p))
      if (exe) return [exe, 'serve', '--service']
      const shim = found.find((p) => /\.(cmd|bat)$/i.test(p))
      if (shim) return ['cmd.exe', '/d', '/s', '/c', `"${shim}" serve --service`]
    } catch {
      // not on PATH — fall through to the client's default spawn
    }
    return undefined
  })()
  return windowsCommand
}

export class OpenCodeService {
  private endpoint: Endpoint | undefined
  private client: ReturnType<typeof OpenCode.make> | undefined
  private status: ServiceStatus = { state: 'connecting', lastCheckedAt: 0 }
  private listeners = new Set<Listener>()
  private reconnectTimer: NodeJS.Timeout | undefined
  private stopped = false

  onStatus(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus(): ServiceStatus {
    return this.status
  }

  /** Client for the current endpoint; throws a friendly error when not attached. */
  get api(): ReturnType<typeof OpenCode.make> {
    if (!this.client) {
      throw new Error(this.status.message ?? 'OpenCode service is not connected yet. Is `opencode` installed?')
    }
    return this.client
  }

  get connected(): boolean {
    return this.status.state === 'connected' && !!this.client
  }

  async ensure(): Promise<ServiceStatus> {
    this.setStatus({ state: 'connecting', lastCheckedAt: Date.now(), message: undefined })
    try {
      const command = await windowsServiceCommand()
      const endpoint = await Service.ensure({
        ...(command ? { command } : {}),
        onStart: (reason) => {
          this.setStatus({
            state: 'connecting',
            lastCheckedAt: Date.now(),
            message: reason === 'missing' ? 'Starting local OpenCode service…' : 'Restarting OpenCode service (version mismatch)…'
          })
        }
      })
      this.endpoint = endpoint
      const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
      const info = await client.server.info()
      this.client = client
      this.setStatus({ state: 'connected', url: endpoint.url, version: info.version, lastCheckedAt: Date.now() })
      this.scheduleHealthCheck()
    } catch (err) {
      this.client = undefined
      this.endpoint = undefined
      const message = describeError(err)
      const missing = /ENOENT|not found|spawn/i.test(message)
      this.setStatus({
        state: missing ? 'missing' : 'error',
        lastCheckedAt: Date.now(),
        message: missing
          ? 'OpenCode was not found on this machine. Install it (https://opencode.ai) and retry.'
          : message
      })
      this.scheduleHealthCheck()
    }
    return this.status
  }

  /** Headless-safe DB path bootstrap note: userData is owned by app, no hardcoded homes. */
  get userDataDir(): string {
    return app.getPath('userData')
  }

  private scheduleHealthCheck(): void {
    if (this.stopped) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      void this.probeAndMaybeReensure()
    }, 15_000)
  }

  /** Cheap probe: if connected but the service died, drop to connecting and re-ensure. */
  private async probeAndMaybeReensure(): Promise<void> {
    if (this.stopped) return
    if (this.connected && this.endpoint) {
      try {
        const res = await fetch(`${this.endpoint.url}/api/server`, {
          headers: Service.headers(this.endpoint) as Record<string, string>,
          signal: AbortSignal.timeout(4000)
        })
        // Any HTTP answer (even 404) means the process is alive; only network failure retries.
        if (res.status >= 0) {
          this.scheduleHealthCheck()
          return
        }
      } catch {
        // fall through to re-ensure
      }
    }
    await this.ensure()
  }

  private setStatus(next: ServiceStatus): void {
    this.status = next
    for (const fn of this.listeners) fn(next)
    pushToWindows({ kind: 'service', status: next })
  }

  dispose(): void {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  // The OpenCode service reports failures as plain structured objects
  // (`{ type, message, status?, response? }`, see `SessionStructuredError`); they reach
  // this function through event payloads and client rejections. Stringifying one would
  // show "[object Object]" in the review panel, so pull what a human needs from it.
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; type?: unknown; name?: unknown; status?: unknown }
    const message = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : ''
    const kind = typeof e.type === 'string' && e.type ? e.type : typeof e.name === 'string' ? e.name : ''
    const status = typeof e.status === 'number' ? e.status : undefined
    const prefix = [kind || undefined, status !== undefined ? `HTTP ${status}` : undefined].filter(Boolean).join(' ')
    if (message) return prefix ? `${message} (${prefix})` : message
    if (prefix) return prefix
    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json.slice(0, 400)
    } catch {
      /* circular — fall through */
    }
  }
  return String(err)
}

export const openCodeService = new OpenCodeService()
