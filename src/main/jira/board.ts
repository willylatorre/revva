/**
 * Board: JQL for the user's current-sprint assigned tickets, mapped to the Ticket DTO,
 * with issue-link dependency detection (blocks → dependsOn). Cached in sqlite.
 * The details dialog fetches description + comments + sub-tasks + all links on open
 * (fetchTicketDetail); the board itself stays lean.
 */
import { jiraMcp, commentListFrom, type JiraLink, type JiraTicket } from './mcp'
import { getDb } from '../db'
import { collectAdfText } from '../util'

const BOARD_JQL =
  "sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done ORDER BY rank ASC"

type RawIssue = {
  id?: string
  key?: string
  self?: string
  fields?: Record<string, unknown>
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Unwrap common MCP result envelopes to an issue array. */
function issuesFrom(result: unknown): RawIssue[] {
  if (Array.isArray(result)) return result as RawIssue[]
  const r = result as Record<string, unknown>
  for (const key of ['issues', 'data', 'results']) {
    const v = r?.[key]
    if (Array.isArray(v)) return v as RawIssue[]
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>)[key]
      if (Array.isArray(inner)) return inner as RawIssue[]
    }
  }
  return []
}

function mapIssue(raw: RawIssue): JiraTicket | undefined {
  const f = raw.fields
  if (!raw.key || !f) return undefined
  const status = f.status as Record<string, unknown> | undefined
  const category = (status?.statusCategory ?? status?.status_category) as Record<string, unknown> | undefined
  const issuetype = f.issuetype as Record<string, unknown> | undefined
  const dependsOn: string[] = []
  const links: JiraLink[] = []
  for (const link of arr(f.issuelinks ?? f.issueLinks)) {
    const l = link as Record<string, unknown>
    const type = (l.type ?? {}) as Record<string, unknown>
    // outward/inward live on the link TYPE; the linked issue sits in outwardIssue (this
    // issue is the outward side, read type.outward) or inwardIssue (read type.inward).
    const outward = l.outwardIssue as Record<string, unknown> | undefined
    const inward = l.inwardIssue as Record<string, unknown> | undefined
    const other = outward ?? inward
    if (!other || typeof other.key !== 'string') continue
    const phrase = String((outward ? type.outward : type.inward) ?? type.name ?? 'links')
    const oFields = (other.fields ?? {}) as Record<string, unknown>
    const oStatus = oFields.status as Record<string, unknown> | undefined
    links.push({
      key: other.key,
      summary: String(oFields.summary ?? ''),
      status: oStatus?.name ? String(oStatus.name) : undefined,
      statusCategory: ((oStatus?.statusCategory as Record<string, unknown> | undefined)?.key as string | undefined) ?? undefined,
      typeName: String(type.name ?? ''),
      phrase
    })
    // Dependency spellings: stock "is blocked by" plus sites with custom link types
    // ("depends on"). Deliberately excludes the reverse direction ("dependend by", "blocks").
    const p = phrase.toLowerCase()
    if (p.includes('blocked by') || p.includes('depends on')) dependsOn.push(other.key)
  }
  const points = f.story_points ?? f.storyPoints ?? f['customfield_10004']
  // Classic projects: parent is an object; team-managed: parent is a one-element array.
  const parent = Array.isArray(f.parent) ? f.parent[0] : f.parent
  const parentKey = (parent as Record<string, unknown> | undefined)?.key
  return {
    key: raw.key,
    id: raw.id ?? raw.key,
    summary: String(f.summary ?? ''),
    status: String((status?.name as string | undefined) ?? (typeof f.status === 'string' ? f.status : '?')),
    statusCategory: String(category?.name ?? category?.key ?? 'New'),
    storyPoints: typeof points === 'number' ? points : Number(points) || undefined,
    issueTypeName: issuetype?.name ? String(issuetype.name) : undefined,
    subtaskCount: Array.isArray(f.subtasks) ? (f.subtasks as unknown[]).length : undefined,
    parentKey: typeof parentKey === 'string' ? parentKey : undefined,
    dependsOn,
    links,
    url: raw.self ? String(raw.self) : undefined,
    raw
  }
}

export async function fetchBoard(): Promise<JiraTicket[]> {
  if (!jiraMcp.connected) await jiraMcp.connect()

  const result = await jiraMcp.search(BOARD_JQL, [
    'summary',
    'status',
    'issuetype',
    'subtasks',
    'issuelinks',
    'story_points',
    'parent'
  ])
  const tickets = issuesFrom(result).map(mapIssue).filter((t): t is JiraTicket => !!t)
  withWebUrls(tickets)

  cacheTickets(tickets)
  return tickets
}

/**
 * `self` in API payloads is the REST URL, not the web page — browsers would open JSON.
 * Point the ticket and its links at the site's /browse/ pages when we know the site;
 * the renderer falls back to hiding the link otherwise.
 */
function withWebUrls(tickets: JiraTicket[]): void {
  const site = jiraMcp.siteWebUrl()
  if (!site) return
  for (const t of tickets) {
    t.url = `${site}/browse/${t.key}`
    for (const l of t.links) l.url = `${site}/browse/${l.key}`
  }
}

/** What the details dialog shows. Only fetched when the dialog opens, never on board load. */
export type TicketDetail = {
  ticket: JiraTicket
  /** Ticket body as markdown (ADF falls back to plain text). */
  description: string
  comments: Array<{ id?: string; author?: string; body: string; created?: string }>
  subtasks: JiraTicket[]
}

/** Body + comments + sub-tasks + all links of one issue, in a single getIssue round-trip. */
export async function fetchTicketDetail(key: string): Promise<TicketDetail> {
  if (!jiraMcp.connected) await jiraMcp.connect()

  const raw = (await jiraMcp.getIssue(key, [
    'summary',
    'description',
    'status',
    'issuetype',
    'subtasks',
    'issuelinks',
    'parent',
    'comment'
  ])) as RawIssue | { issue?: RawIssue }
  const issue = (raw as RawIssue)?.fields ? (raw as RawIssue) : (raw as { issue?: RawIssue }).issue
  if (!issue?.fields) throw new Error(`Jira returned no fields for ${key}.`)
  const fields = issue.fields

  // Sub-tasks sit under fields.subtasks; some envelopes hoist them to the top level.
  let list = arr(fields.subtasks ?? (raw as Record<string, unknown>)?.subtasks)
  if (list.length === 0 && arr(fields.issuelinks ?? fields.issueLinks).length === 0) {
    // Both reads came back empty — fall back to what the board search cached for this key.
    const row = getDb().prepare('SELECT raw FROM ticket WHERE key = ?').get(key) as { raw: string } | undefined
    if (row) {
      try {
        const cached = JSON.parse(row.raw) as RawIssue
        list = arr((cached.fields as Record<string, unknown> | undefined)?.subtasks)
      } catch {
        /* cached raw was not parseable — nothing to fall back to */
      }
    }
  }
  const subtasks = list
    .map((s) => {
      const r = s as RawIssue
      // Some feeds key subtasks by id only; key is what every downstream uses.
      return mapIssue({ ...r, key: r.key ?? (r.id ? String(r.id) : undefined) })
    })
    .filter((t): t is JiraTicket => !!t)

  const description = (() => {
    const d = fields.description
    if (typeof d === 'string') return d.trim()
    if (d && typeof d === 'object') return collectAdfText(d).join('\n').trim()
    return ''
  })()

  const comments = commentListFrom(fields.comment)
    .map((c) => ({
      id: c.id ? String(c.id) : undefined,
      author: c.author?.displayName ?? 'unknown',
      // Comment bodies are markdown or ADF depending on how they were written.
      body: typeof c.body === 'string' ? c.body : collectAdfText(c.body).join(' ').trim(),
      created: c.created
    }))
    .filter((c) => c.body.length > 0)

  const ticket = mapIssue(issue)
  if (!ticket) throw new Error(`Jira returned an unreadable issue for ${key}.`)
  withWebUrls([ticket, ...subtasks])
  cacheTickets([ticket, ...subtasks])
  return { ticket, description, comments, subtasks }
}

function cacheTickets(tickets: JiraTicket[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO ticket(key, jira_id, summary, status, status_category, points, depends_on, raw, synced_at, issue_type, subtask_count, parent_key)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET summary=excluded.summary, status=excluded.status,
       status_category=excluded.status_category, points=excluded.points,
       depends_on=excluded.depends_on, raw=excluded.raw, synced_at=excluded.synced_at,
       issue_type=excluded.issue_type, subtask_count=excluded.subtask_count,
       parent_key=excluded.parent_key`
  )
  const tx = db.transaction((rows: JiraTicket[]) => {
    for (const t of rows) {
      stmt.run(t.key, t.id, t.summary, t.status, t.statusCategory, t.storyPoints ?? null, JSON.stringify(t.dependsOn), JSON.stringify(t.raw), now, t.issueTypeName ?? null, t.subtaskCount ?? null, t.parentKey ?? null)
    }
  })
  tx(tickets)
}

export async function getTicket(key: string): Promise<JiraTicket | undefined> {
  const row = getDb().prepare('SELECT * FROM ticket WHERE key = ?').get(key) as
    | { key: string; jira_id: string; summary: string; status: string; status_category: string; points: number | null; depends_on: string; raw: string; issue_type: string | null; subtask_count: number | null; parent_key: string | null }
    | undefined
  if (row) {
    return {
      key: row.key,
      id: row.jira_id,
      summary: row.summary,
      status: row.status,
      statusCategory: row.status_category,
      storyPoints: row.points ?? undefined,
      issueTypeName: row.issue_type ?? undefined,
      subtaskCount: row.subtask_count ?? undefined,
      parentKey: row.parent_key ?? undefined,
      dependsOn: JSON.parse(row.depends_on) as string[],
      links: linksFromRaw(row.raw),
      raw: JSON.parse(row.raw) as unknown
    }
  }
  try {
    const raw = (await jiraMcp.getIssue(key)) as RawIssue
    return mapIssue(raw)
  } catch {
    return undefined
  }
}

/** Links are not a column; re-read them from the cached raw payload. */
function linksFromRaw(raw: string): JiraLink[] {
  try {
    return mapIssue(JSON.parse(raw) as RawIssue)?.links ?? []
  } catch {
    return []
  }
}
