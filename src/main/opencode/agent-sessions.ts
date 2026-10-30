/** Native parent/child relationships; no duplicated transcript or execution state. */
import type { AgentSession } from '@shared/types'
import type { SessionInfo } from '@opencode/client'
import { getDb } from '../db'
import { pushToWindows } from '../push'
import { eventBus, type RawEvent, runningSignal } from './bus'
import { openCodeService } from './service'
import { sessionIndex } from './session-index'
import { inboxManager } from './inbox'

interface AgentRow {
  session_id: string
  parent_id: string
  root_id: string
  title: string
  directory: string
  agent_id: string | null
  outcome: AgentSession['outcome'] | null
  updated_at: number
}

const summary = (row: AgentRow): AgentSession => ({
  sessionId: row.session_id, parentId: row.parent_id, rootId: row.root_id,
  title: row.title, directory: row.directory, agentID: row.agent_id ?? undefined,
  outcome: row.outcome ?? undefined, updatedAt: row.updated_at
})

class AgentSessions {
  private wired = false
  private recovery: Promise<void> | undefined
  private childDeliveries = new Set<string>()
  private reviewFences = new Set<string>()

  /** Serialize Revva child delivery with review startup, including asynchronous service calls. */
  async deliverToChild<T>(sessionId: string, deliver: () => Promise<T>): Promise<T> {
    const root = this.rootOf(sessionId)
    if (!root || root === sessionId) throw new Error('Child agent not found.')
    const work = getDb().prepare('SELECT id, state FROM work WHERE session_id = ?').get(root) as { id: string; state: string } | undefined
    if (this.reviewFences.has(root) || (work && (['REVIEW', 'FIXING'].includes(work.state) || getDb().prepare("SELECT 1 FROM review WHERE work_id = ? AND status IN ('pending','running') LIMIT 1").get(work.id)))) {
      throw new Error('Review is in progress. Wait for it to finish before continuing a child agent.')
    }
    if (this.childDeliveries.has(root)) throw new Error('Another child follow-up is being delivered. Try again shortly.')
    this.childDeliveries.add(root)
    try { return await deliver() } finally { this.childDeliveries.delete(root) }
  }

  fenceReview(root: string | null): () => void {
    if (!root) return () => undefined
    if (this.childDeliveries.has(root) || this.reviewFences.has(root)) throw new Error('A child agent follow-up is being delivered. Wait before starting review.')
    this.reviewFences.add(root)
    return () => this.reviewFences.delete(root)
  }

  /** Refresh the entire live tree, not just the index or immediate children. */
  async requireStoppedTree(root: string | null): Promise<void> {
    if (!root) return
    const ids = [root]
    for (let i = 0; i < ids.length; i++) {
      for (const child of await this.children(ids[i]!)) if (!ids.includes(child.sessionId)) ids.push(child.sessionId)
    }
    const active = await openCodeService.api.session.active()
    const running = ids.find((id) => id in active)
    if (running) throw new Error(`Implementation or delegated agent ${running} is still running. Wait for it to finish before reviewing.`)
    for (const sessionID of ids) {
      const queued = await openCodeService.api.session.inbox.list({ sessionID })
      if (queued.some((item) => item.type === 'user')) throw new Error(`Session ${sessionID} has queued messages. Send or remove them before reviewing.`)
    }
  }

  get(sessionId: string): AgentSession | undefined {
    const row = getDb().prepare('SELECT * FROM agent_session WHERE session_id = ?').get(sessionId) as AgentRow | undefined
    return row ? summary(row) : undefined
  }

  rootOf(sessionId: string): string | undefined {
    const kind = sessionIndex.kindOf(sessionId)
    if (kind === 'chat' || kind === 'work') return sessionId
    const root = kind === 'agent' ? this.get(sessionId)?.rootId : undefined
    return root && ['chat', 'work'].includes(sessionIndex.kindOf(root) ?? '') ? root : undefined
  }

  register(session: SessionInfo): boolean {
    // Forks are independent conversations, not delegated tasks.
    if (!session.parentID || session.fork || sessionIndex.kindOf(session.id) === 'chat' || sessionIndex.kindOf(session.id) === 'work') return false
    const root = this.rootOf(session.parentID)
    if (!root) return false
    getDb().prepare(`INSERT INTO agent_session(session_id, parent_id, root_id, title, directory, agent_id, outcome, updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      title=excluded.title, directory=excluded.directory, agent_id=excluded.agent_id,
      outcome=excluded.outcome, updated_at=excluded.updated_at`).run(
      session.id, session.parentID, root, session.title ?? 'Agent task', session.location.directory,
      session.agent ?? null, session.outcome ?? null, session.time.updated
    )
    sessionIndex.register(session.id, 'agent')
    return true
  }

  async children(parentId: string): Promise<AgentSession[]> {
    if (!this.rootOf(parentId)) return []
    const previous = (getDb().prepare('SELECT session_id FROM agent_session WHERE parent_id = ?').all(parentId) as Array<{ session_id: string }>).map((row) => row.session_id)
    const found = new Set<string>()
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await openCodeService.api.session.list({ parentID: parentId, limit: 100, cursor })
      for (const session of page.data) if (this.register(session)) found.add(session.id)
      cursor = page.cursor.next ?? undefined
      if (cursor && seen.has(cursor)) throw new Error('Could not enumerate all delegated agents. Try again before reviewing.')
      if (cursor) seen.add(cursor)
    } while (cursor)
    for (const id of previous) if (!found.has(id)) this.forget(id)
    return (getDb().prepare('SELECT * FROM agent_session WHERE parent_id = ? ORDER BY updated_at DESC').all(parentId) as AgentRow[]).map(summary)
  }

  wire(): void {
    if (this.wired) return
    this.wired = true
    eventBus.on('event', (event: RawEvent) => this.onEvent(event))
    eventBus.on('stream:reconnect', () => void this.reconcile().catch((error) => console.warn('[agents] recovery failed:', error)))
  }

  /** One paginated scan on reconnect recovers descendants missed while Revva was closed. */
  reconcile(): Promise<void> {
    if (this.recovery) return this.recovery
    this.recovery = this.recover().finally(() => { this.recovery = undefined })
    return this.recovery
  }

  private async recover(): Promise<void> {
    const previous = sessionIndex.agents()
    const children: SessionInfo[] = []
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await openCodeService.api.session.list({ limit: 200, cursor })
      children.push(...page.data.filter((session) => session.parentID && !session.fork))
      cursor = page.cursor.next ?? undefined
      if (cursor && seen.has(cursor)) break
      if (cursor) seen.add(cursor)
    } while (cursor)
    // Parents may be on a later page than their children.
    let remaining = children
    while (remaining.length) {
      const next = remaining.filter((session) => !this.register(session))
      if (next.length === remaining.length) break
      remaining = next
    }
    const found = new Set(children.map((session) => session.id))
    for (const id of previous) if (!found.has(id) || !this.rootOf(id)) this.forget(id)
    pushToWindows({ kind: 'session.children', sessionId: '*' })
    await inboxManager.resync(true)
  }

  private onEvent(event: RawEvent): void {
    const id = event.data?.sessionID
    if (typeof id !== 'string') return
    if (event.type === 'session.created' && typeof event.data?.parentID === 'string' && this.rootOf(event.data.parentID)) {
      // Register synchronously so following form/permission events are never dropped.
      const data = event.data
      const location = data.location as { directory?: string } | undefined
      if (!location?.directory) return
      this.register({ id, parentID: data.parentID, title: data.title, agent: data.agent, location,
        time: { created: event.created, updated: event.created } } as SessionInfo)
      pushToWindows({ kind: 'session.children', sessionId: data.parentID as string })
      return
    }
    if (sessionIndex.kindOf(id) !== 'agent') return
    const child = this.get(id)
    if (!child) return
    if (event.type === 'session.deleted') {
      this.forget(id)
    } else if (event.type === 'session.renamed' && typeof event.data?.title === 'string') {
      getDb().prepare('UPDATE agent_session SET title = ?, updated_at = ? WHERE session_id = ?').run(event.data.title, Date.now(), id)
    } else if (event.type === 'session.moved') {
      void openCodeService.api.session.get({ sessionID: id }).then((session) => this.register(session)).catch(() => undefined)
    } else if (runningSignal(event) !== undefined) {
      const outcome = event.type === 'session.execution.succeeded' ? 'succeeded'
        : event.type === 'session.execution.failed' ? 'failed' : event.type === 'session.execution.interrupted' ? 'interrupted' : null
      getDb().prepare('UPDATE agent_session SET outcome = ?, updated_at = ? WHERE session_id = ?').run(outcome, Date.now(), id)
    } else return
    pushToWindows({ kind: 'session.children', sessionId: child.parentId })
  }

  forget(sessionId: string): void {
    const descendants = getDb().prepare('SELECT session_id FROM agent_session WHERE parent_id = ?').all(sessionId) as Array<{ session_id: string }>
    for (const child of descendants) this.forget(child.session_id)
    getDb().prepare('DELETE FROM agent_session WHERE session_id = ?').run(sessionId)
    sessionIndex.forget(sessionId)
    inboxManager.forgetSession(sessionId)
  }

  forgetChildren(rootId: string): void {
    const rows = getDb().prepare('SELECT session_id FROM agent_session WHERE root_id = ?').all(rootId) as Array<{ session_id: string }>
    for (const row of rows) this.forget(row.session_id)
  }
}

export const agentSessions = new AgentSessions()
