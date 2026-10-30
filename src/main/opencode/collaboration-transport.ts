/** Local-only, bearer-authenticated MCP transport for runtime OpenCode registration. */
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ClientMcpTool } from '@opencode/client/mcp'

interface Mount { token: string; tools: ClientMcpTool[] }

class CollaborationTransport {
  private server: HttpServer | undefined
  private starting: Promise<string> | undefined
  private mounts = new Map<string, Mount>()
  private active = new Set<Server>()
  private origin: string | undefined

  async mount(tools: ClientMcpTool[]): Promise<{ url: string; headers: Record<string, string>; close(): void }> {
    const origin = await this.listen()
    const path = `/mcp/${randomUUID()}`
    const token = randomBytes(32).toString('hex')
    this.mounts.set(path, { token, tools })
    return { url: `${origin}${path}`, headers: { Authorization: `Bearer ${token}` }, close: () => { this.mounts.delete(path) } }
  }

  private listen(): Promise<string> {
    if (this.starting) return this.starting
    this.starting = new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500)
          response.end()
        })
      })
      this.server = server
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') { reject(new Error('Cannot listen for Revva collaboration.')); return }
        this.origin = `http://127.0.0.1:${address.port}`
        resolve(this.origin)
      })
    })
    return this.starting
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const mount = this.mounts.get(request.url ?? '')
    // Reject browser-origin calls and DNS rebinding before invoking the MCP SDK.
    if (!mount || request.headers.origin || request.headers.host !== new URL(this.origin!).host || request.headers.authorization !== `Bearer ${mount.token}`) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return }
    if (this.active.size >= 32) { response.writeHead(429).end(); return }
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 256 * 1024) { response.writeHead(413).end(); return }
      chunks.push(Buffer.from(chunk))
    }
    let body: unknown
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { response.writeHead(400).end(); return }
    const server = new Server({ name: 'Revva collaboration', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: mount.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { ...tool.inputSchema, type: 'object' as const } }))
    }))
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const tool = mount.tools.find((tool) => tool.name === call.params.name)
      if (!tool) throw new Error('Unknown Revva collaboration tool.')
      const sessionID = call.params._meta?.['ai.opencode/sessionID']
      try {
        return await tool.handler(call.params.arguments ?? {}, { sessionID: typeof sessionID === 'string' ? sessionID : undefined })
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Revva collaboration failed.' }] }
      }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    this.active.add(server)
    response.on('close', () => { this.active.delete(server); void server.close() })
    await server.connect(transport)
    await transport.handleRequest(request, response, body)
  }

  async dispose(): Promise<void> {
    this.mounts.clear()
    await Promise.allSettled([...this.active].map((server) => server.close()))
    this.server?.closeAllConnections()
    await new Promise<void>((resolve) => { if (this.server?.listening) this.server.close(() => resolve()); else resolve() })
  }
}

export const collaborationTransport = new CollaborationTransport()
