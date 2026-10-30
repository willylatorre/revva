/**
 * One place that turns raw execution events into the one-line activity strings
 * the UIs show ("Running: bash · pnpm typecheck"). Reviewers and delegated
 * children share it so their status text cannot drift apart.
 *
 * The tracker keeps in-flight tool calls because a tool's own event does not
 * repeat its input — the summary needs the pair the call event carried.
 */
import type { RawEvent } from './bus'

export class ActivityTracker {
  private tools = new Map<string, { name: string; detail?: string }>()

  /** Text for this event, or undefined when the event says nothing the user would read. */
  describe(event: RawEvent): string | undefined {
    const data = (event.data ?? {}) as Record<string, unknown>
    if (event.type === 'session.execution.started') return 'Waiting for model…'
    if (event.type.startsWith('session.reasoning.')) return 'Reasoning'
    if (event.type.startsWith('session.text.')) return 'Generating response'
    if (event.type === 'session.tool.input.started' && typeof data.id === 'string') {
      const name = String(data.name ?? 'tool')
      this.tools.set(data.id, { name })
      return `Preparing: ${name}`
    }
    if (event.type === 'session.tool.called' || event.type === 'session.tool.success' || event.type === 'session.tool.failed') {
      const id = String(data.id ?? '')
      const tool = this.tools.get(id)
      const input = data.input as Record<string, unknown> | undefined
      const detail = input && ['command', 'path', 'filePath', 'pattern', 'query', 'url', 'description'].map((key) => input[key]).find((value) => typeof value === 'string') || tool?.detail
      const name = String(data.name ?? tool?.name ?? 'tool')
      const verb = event.type === 'session.tool.called' ? 'Running' : event.type === 'session.tool.failed' ? 'Failed' : 'Finished'
      const text = `${verb}: ${name}${detail ? ` · ${this.firstLine(detail)}` : ''}`
      if (event.type === 'session.tool.called') this.tools.set(id, { name, detail: detail ? String(detail) : undefined })
      else this.tools.delete(id)
      return text
    }
    if (event.type === 'session.tool.progress') {
      const tool = this.tools.get(String(data.id ?? ''))
      return `Running: ${tool?.name ?? 'tool'}${tool?.detail ? ` · ${this.firstLine(tool.detail)}` : ''}`
    }
    if (event.type === 'session.retry.scheduled') return `Retrying model · attempt ${String(data.attempt ?? '')}`
    if (event.type === 'session.status') {
      const status = data.status as { type?: string; message?: string } | undefined
      if (status?.type === 'retry') return `Retrying${status.message ? ` · ${status.message.slice(0, 180)}` : ''}`
    }
    return undefined
  }

  private firstLine(text: string): string {
    return text.split('\n')[0]?.slice(0, 180) ?? ''
  }
}
