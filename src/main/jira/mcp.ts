/**
 * Atlassian MCP client with Revva-owned auth (docs/ARCHITECTURE.md §4).
 *
 * The MCP tool inventory differs across Atlassian deployments — and between MCP v1 and v2 —
 * so at connect time we `tools/list` (all pages) and map CAPABILITIES (search/JQL, get issue,
 * comments, transitions, user info) to actual tool names behind this stable interface. Nothing
 * downstream hardcodes an Atlassian tool name, and inputs are filtered through the discovered
 * schema because v2 declares `additionalProperties: false` on its tool inputs.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { jiraAuth, MCP_URL } from './auth'

export type JiraTicket = {
  key: string
  id: string
  summary: string
  status: string
  statusCategory: string
  storyPoints?: number
  issueTypeName?: string
  /** Number of sub-tasks reported on the issue (0 ⇒ none). */
  subtaskCount?: number
  /** Sub-task's parent issue key (unset for non-subtasks). */
  parentKey?: string
  dependsOn: string[]
  /** Every issue link on the ticket, with its direction read from the link type. */
  links: JiraLink[]
  url?: string
  raw: unknown
}

/** One issuelink rendered the way Jira reads it: "<this ticket> is blocked by PROJ-1". */
export type JiraLink = {
  key: string
  summary: string
  status?: string
  statusCategory?: string
  /** Link type name ("Blocks", "Relates", …). */
  typeName: string
  /** Directional phrase from this ticket's point of view, e.g. "is blocked by". */
  phrase: string
  /** Web URL for the linked issue, when the site's browse URL is known. */
  url?: string
}

export type JiraCapability =
  | 'search'
  | 'getIssue'
  | 'addComment'
  | 'transition'
  | 'getTransitions'
  | 'resources'
  | 'user'

type ToolDef = { name: string; description?: string; inputSchema?: Record<string, unknown> }

/**
 * Preferred tool-name patterns per capability, matched against the live inventory.
 * Both v1 and v2 spellings are listed: v1 stops working 2027-03-01, when Atlassian flips
 * existing v1 connections onto the v2 tool surface, and v2 renames the transitions/comment
 * tools (verified 2026-10-30 against `?tools=all` plus the supported-tools page).
 */
const CAPABILITY_PATTERNS: Record<JiraCapability, RegExp[]> = {
  search: [/searchJiraIssuesUsingJql/i, /search.*\bjql\b/i],
  getIssue: [/^getJiraIssue$/, /get.*issue(?!s)/i],
  addComment: [/^addOrEditJiraIssueComment$/, /^addCommentToJiraIssue$/, /add.*comment/i],
  transition: [/transitionJiraIssue/, /^transitionIssue$/],
  getTransitions: [/^listJiraIssueTransitions$/, /getTransitionsForJiraIssue/, /list.*transitions/i, /get.*transitions/i],
  resources: [/^getAccessibleAtlassianResources$/, /accessible.*(resource|site)/i],
  user: [/^atlassianUserInfo$/, /user.*info/i]
}

/** Capabilities without which the board, ship and watcher cannot function. */
const REQUIRED_CAPABILITIES: JiraCapability[] = ['search', 'getIssue', 'resources']

export class JiraMcp {
  private client: Client | undefined
  private tools: ToolDef[] = []
  private capMap = new Map<JiraCapability, string>()
  private cloudId: string | undefined
  private cachedAccountId: string | null | undefined

  get connected(): boolean {
    return !!this.client
  }

  async connect(): Promise<void> {
    const token = await jiraAuth.accessToken()
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
    const client = new Client({ name: 'revva', version: '0.0.1' })
    let tools: ToolDef[]
    try {
      await client.connect(transport)
      tools = await listAllTools(client)
    } catch (err) {
      await client.close().catch(() => undefined)
      throw err
    }
    this.client = client
    client.onclose = () => {
      if (this.client !== client) return
      this.client = undefined
      this.capMap.clear()
      this.cloudId = undefined
      this.siteUrl = undefined
    }
    this.tools = tools
    this.capMap = buildCapabilityMap(this.tools)
    const missing = REQUIRED_CAPABILITIES.filter((cap) => !this.capMap.has(cap))
    if (missing.length) {
      await this.disconnect()
      throw new Error(`Atlassian MCP v2 did not expose: ${missing.join(', ')}. Check the Jira scopes on the connection.`)
    }
    // Dev aid: dump the live contract so argument names can be verified, not guessed.
    try {
      const { app } = await import('electron')
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      writeFileSync(join(app.getPath('userData'), 'jira-tools.json'), JSON.stringify(this.tools, null, 2))
    } catch {
      /* ignore */
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.close().catch(() => undefined)
    this.client = undefined
    this.capMap.clear()
    this.cloudId = undefined
    this.siteUrl = undefined
  }

  /** Re-auth + reconnect (token rotated or stream died). */
  async reconnect(): Promise<void> {
    await this.disconnect()
    await this.connect()
  }

  private tool(cap: JiraCapability): string {
    const name = this.capMap.get(cap)
    if (!name) throw new Error(`Your Atlassian site does not expose the "${cap}" capability via MCP.`)
    return name
  }

  /**
   * v2 tool schemas set `additionalProperties: false`, so an input Atlassian renamed or dropped
   * becomes a hard call failure. Send only what the discovered schema declares, and fail loudly
   * when the tool requires something we do not supply rather than with an opaque schema error.
   */
  private argsFor(cap: JiraCapability, args: Record<string, unknown>): Record<string, unknown> {
    const def = this.tools.find((t) => t.name === this.capMap.get(cap))
    const props = def?.inputSchema?.properties as Record<string, unknown> | undefined
    if (!props) return args
    const kept: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) if (key in props) kept[key] = value
    const required = Array.isArray(def?.inputSchema?.required) ? (def!.inputSchema!.required as string[]) : []
    const missing = required.filter((key) => !(key in kept))
    if (missing.length) {
      throw new Error(`Atlassian MCP tool "${def?.name}" requires ${missing.join(', ')}; Revva's Jira call needs updating.`)
    }
    return kept
  }

  /** Every Jira MCP tool requires cloudId; resolve once from accessible resources. */
  private siteUrl: string | undefined
  private async resolveCloudId(): Promise<string> {
    if (this.cloudId) return this.cloudId
    const res = await this.call<unknown>('resources', {})
    const list = Array.isArray(res)
      ? res
      : ((res as { data?: unknown[] })?.data ?? (Array.isArray((res as { resources?: unknown[] })?.resources) ? (res as { resources: unknown[] }).resources : []))
    const first = list[0] as { id?: string; url?: string } | undefined
    const id = first?.id ?? (first?.url ? new URL(first.url).host : undefined)
    if (!id) throw new Error('No accessible Atlassian site for this account.')
    this.cloudId = id
    if (first?.url) this.siteUrl = first.url.replace(/\/$/, '')
    return id
  }

  /** Web URL of the primary site, so linked issue keys can become /browse/PROJ-N links. */
  siteWebUrl(): string | undefined {
    return this.siteUrl
  }

  private async call<T>(cap: JiraCapability, args: Record<string, unknown>): Promise<T> {
    if (!this.client) throw new Error('Jira not connected.')
    const name = this.tool(cap)
    const input = this.argsFor(cap, args)
    try {
      const res = await this.client.callTool({ name, arguments: input })
      return parseToolResult<T>(res)
    } catch (err) {
      // One transparent retry after re-auth covers token rotation.
      try {
        await this.reconnect()
        const res = await this.client!.callTool({ name: this.tool(cap), arguments: this.argsFor(cap, args) })
        return parseToolResult<T>(res)
      } catch (err2) {
        throw err2 instanceof Error && err2.message.includes('not connected') ? err : err2
      }
    }
  }

  /** JQL search returning raw-ish issue records (mapped later by board.ts). */
  async search(jql: string, fields?: string[]): Promise<unknown> {
    const cloudId = await this.resolveCloudId()
    return this.call('search', {
      cloudId,
      jql,
      maxResults: 50,
      ...(fields ? { fields } : {}),
      responseContentFormat: 'markdown'
    })
  }

  async getIssue(key: string, fields?: string[]): Promise<unknown> {
    const cloudId = await this.resolveCloudId()
    return this.call('getIssue', {
      cloudId,
      issueIdOrKey: key,
      ...(fields ? { fields } : {}),
      responseContentFormat: 'markdown'
    })
  }

  async addComment(key: string, body: string): Promise<unknown> {
    const cloudId = await this.resolveCloudId()
    return this.call('addComment', { cloudId, issueIdOrKey: key, commentBody: body, contentFormat: 'markdown' })
  }

  async listTransitions(key: string): Promise<unknown> {
    const cloudId = await this.resolveCloudId()
    return this.call('getTransitions', { cloudId, issueIdOrKey: key })
  }

  /**
   * Comments come from the whole issue rather than v2's `listJiraIssueComments`: that tool is
   * paginated oldest-first, so a long ticket's newest comments could sit past the first page
   * and the watcher would silently stop seeing them. `fields.comment` is the trusted read.
   */
  async comments(key: string): Promise<Array<{ id?: string; author?: { displayName?: string; accountId?: string }; body?: unknown; created?: string }>> {
    const raw = (await this.getIssue(key)) as { fields?: Record<string, unknown> } | { issue?: { fields?: Record<string, unknown> } }
    const fields = (raw as { fields?: Record<string, unknown> })?.fields ?? (raw as { issue?: { fields?: Record<string, unknown> } })?.issue?.fields
    return commentListFrom(fields?.comment)
  }

  /** Our own account id, so we can skip comments revva itself posted. */
  async myAccountId(): Promise<string | undefined> {
    if (this.cachedAccountId !== undefined) return this.cachedAccountId ?? undefined
    try {
      const raw = (await this.call('user', {})) as { accountId?: string; user?: { accountId?: string } }
      this.cachedAccountId = raw?.accountId ?? raw?.user?.accountId ?? null
    } catch {
      this.cachedAccountId = null
    }
    return this.cachedAccountId ?? undefined
  }

  async transitionIssue(key: string, transitionId: string): Promise<unknown> {
    const cloudId = await this.resolveCloudId()
    return this.call('transition', { cloudId, issueIdOrKey: key, transition: { id: transitionId } })
  }

  inventory(): ToolDef[] {
    return this.tools
  }

  capabilities(): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const cap of Object.keys(CAPABILITY_PATTERNS) as JiraCapability[]) {
      out[cap] = this.capMap.get(cap)
    }
    return out
  }
}

function buildCapabilityMap(tools: ToolDef[]): Map<JiraCapability, string> {
  const map = new Map<JiraCapability, string>()
  for (const [cap, regs] of Object.entries(CAPABILITY_PATTERNS)) {
    for (const re of regs) {
      const hit = tools.find((t) => re.test(t.name))
      if (hit) {
        map.set(cap as JiraCapability, hit.name)
        break
      }
    }
  }
  return map
}

/**
 * `?tools=all` returns a *paginated* flat list, so a single `listTools()` would silently see
 * only the first page and lose the capabilities mapped to later tools. Follow the cursor.
 */
async function listAllTools(client: Client): Promise<ToolDef[]> {
  const out: ToolDef[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const listed = await client.listTools(cursor ? { cursor } : undefined)
    for (const t of listed.tools) {
      if (seen.has(t.name)) continue
      seen.add(t.name)
      out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> | undefined })
    }
    cursor = listed.nextCursor
    if (!cursor) break
  }
  return out
}

type JiraComment = { id?: string; author?: { displayName?: string; accountId?: string }; body?: unknown; created?: string }

/** Comments arrive as `fields.comment.comments`, or as the tool's own array/envelope. */
export function commentListFrom(v: unknown): JiraComment[] {
  if (!v) return []
  if (Array.isArray(v)) return v as JiraComment[]
  const o = v as Record<string, unknown>
  for (const key of ['comments', 'results', 'data']) {
    const inner = o[key]
    if (Array.isArray(inner)) return inner as JiraComment[]
    if (inner && typeof inner === 'object') {
      const nested = (inner as Record<string, unknown>)[key]
      if (Array.isArray(nested)) return nested as JiraComment[]
    }
  }
  return []
}

/** MCP results come back as content blocks; JSON payloads arrive as text. */
export function parseToolResult<T>(res: unknown): T {
  const r = res as { isError?: boolean; content?: Array<{ type: string; text?: string }> }
  const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  if (r.isError) throw new Error(text || 'Atlassian MCP tool error')
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export const jiraMcp = new JiraMcp()
