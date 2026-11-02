/**
 * Shares Revva's Atlassian MCP connection with the OpenCode harness (one OAuth consent,
 * one permission surface).
 *
 * The bridge mounts Revva's *live discovered* Atlassian tool inventory onto the same
 * local bearer-authenticated transport as the collaboration tools, then registers it with
 * the service under the server name `atlassian`. A runtime `mcp.add` shadows a config-declared
 * server of the same name for that location (verified against the live service), so agents —
 * and any other OpenCode client pointed at these checkouts — get `atlassian_*` tools backed by
 * Revva's token in OS keychain storage. Revva never reads OpenCode's token cache, and the
 * harness never holds an Atlassian token: hourly refreshes stay invisible to the harness.
 *
 * Deliberate constraints (both verified live 2026-11-02):
 *  - Never `mcp.remove`: it also hides the location's *inherited* config entry, and that
 *    deletion persists server-side. Revva only ever adds/replaces.
 *  - Never register while signed out: an empty-tools server parks the integration in
 *    `pending`. Directories are remembered and (re-)registered when the inventory changes.
 */
import type { ClientMcpTool } from '@opencode/client/mcp'
import { collaborationTransport } from '../opencode/collaboration-transport'
import { openCodeService, describeError } from '../opencode/service'
import { eventBus } from '../opencode/bus'
import { jiraMcp, type RawToolResult } from './mcp'

/** Must match the name agents (and the user's config) know this server by. */
export const BRIDGE_SERVER_NAME = 'atlassian'
const TOOL_NAME = /^[a-zA-Z0-9_-]+$/

type Mount = { url: string; headers: Record<string, string>; close(): void; generation: string; connected: boolean }

class JiraBridge {
  private directories = new Set<string>()
  private mounts = new Map<string, Mount>()
  /** Serialize per directory so inventory/service events cannot interleave adds. */
  private pending = new Map<string, Promise<void>>()
  private disposed = false

  wire(): void {
    jiraMcp.onInventoryChange(() => void this.reregister())
    eventBus.on('stream:reconnect', () => {
      // The service rebuilt its world; prior runtime registrations are gone.
      this.mounts.clear()
      void this.reregister()
    })
    openCodeService.onStatus((status) => {
      // Anything but 'connected' means a re-ensure is underway — the service (and with it
      // every runtime registration) may be gone. Clear so the next 'connected' really re-adds.
      if (status.state === 'connected') void this.reregister()
      else this.mounts.clear()
    })
  }

  /** Called for every checkout a Revva session lives in (coordinator.connect). */
  ensureCheckout(directory: string): void {
    this.directories.add(directory)
    this.enqueue(directory).catch((error) => console.warn('[jira-bridge] register failed:', describeError(error)))
  }

  /** Checkouts whose harness location currently runs the bridged server, for Setup's status. */
  get registeredCount(): number {
    let count = 0
    for (const mount of this.mounts.values()) if (mount.connected) count++
    return count
  }

  /** Sign-in, token reconnect or service restart: re-offer the bridge to every known checkout. */
  private async reregister(): Promise<void> {
    if (this.disposed || !openCodeService.connected) return
    for (const directory of [...this.directories]) {
      try {
        await this.enqueue(directory)
      } catch (error) {
        console.warn('[jira-bridge] register failed:', describeError(error))
      }
    }
  }

  /** Chain onto any in-flight registration for this directory; never drop an event. */
  private enqueue(directory: string): Promise<void> {
    const running = this.pending.get(directory)
    const work = running ? running.then(() => this.registerFresh(directory)) : this.registerFresh(directory)
    this.pending.set(
      directory,
      work.catch(() => undefined)
    )
    return work
  }

  private async registerFresh(directory: string): Promise<void> {
    if (this.disposed || !openCodeService.connected) return
    const tools = this.tools()
    // Signed out or still connecting: leave nothing behind; inventory change retries.
    if (!tools.length) return
    const generation = generationOf(tools)
    const current = this.mounts.get(directory)
    if (current?.connected && current.generation === generation) return
    const mount = await collaborationTransport.mount(tools)
    try {
      await openCodeService.api.mcp.add(
        { server: BRIDGE_SERVER_NAME, location: { directory }, config: { type: 'remote', url: mount.url, headers: mount.headers, oauth: false, codemode: true } },
        { signal: AbortSignal.timeout(15_000) }
      )
      const status = await openCodeService.api.mcp.list({ location: { directory } }, { signal: AbortSignal.timeout(5_000) })
      const server = status.data.find((entry) => entry.name === BRIDGE_SERVER_NAME)
      const connected = server?.status.status === 'connected'
      if (!connected) console.warn('[jira-bridge] registered but not connected:', directory, JSON.stringify(server?.status ?? 'absent'))
      current?.close()
      this.mounts.set(directory, { ...mount, generation, connected })
    } catch (error) {
      // The add failed — keep any previously connected mount, discard this one.
      mount.close()
      throw error
    }
  }

  /** Every discovered Atlassian tool, forwarded raw through Revva's authenticated client. */
  private tools(): ClientMcpTool[] {
    if (!jiraMcp.connected) return []
    return jiraMcp
      .inventory()
      .filter((tool) => TOOL_NAME.test(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: async (args: Record<string, unknown>) => {
          try {
            return toClientResult(await jiraMcp.callRaw(tool.name, args))
          } catch (error) {
            return {
              isError: true as const,
              content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Atlassian call failed.' }]
            }
          }
        }
      }))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const mount of this.mounts.values()) mount.close()
    this.mounts.clear()
  }
}

/**
 * Inventory identity: re-register when tools appear, disappear, change name, description
 * or schema — i.e. whenever what the model can call has changed.
 */
function generationOf(tools: ClientMcpTool[]): string {
  return tools
    .map((tool) => `${tool.name}\u0000${tool.description ?? ''}\u0000${JSON.stringify(tool.inputSchema ?? {})}`)
    .sort()
    .join('\u0001')
}

/** Only text/image blocks are portable to the client-MCP result shape; everything else degrades to text. */
function toClientResult(result: RawToolResult): { content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean } {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = []
  for (const block of result.content ?? []) {
    const b = block as { type?: string; text?: string; data?: string; mimeType?: string }
    if (b.type === 'text') content.push({ type: 'text', text: b.text ?? '' })
    else if (b.type === 'image' && b.data && b.mimeType) content.push({ type: 'image', data: b.data, mimeType: b.mimeType })
    else content.push({ type: 'text', text: JSON.stringify(block) })
  }
  return { content, ...(result.isError ? { isError: true } : {}) }
}

export const jiraBridge = new JiraBridge()
