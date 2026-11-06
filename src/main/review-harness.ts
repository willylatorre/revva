import type { SkillGuardRule } from './opencode/skill-guard'
import type { RawEvent } from './opencode/bus'

/** Hard limits, not targets. Exhaustion always blocks the review gate. */
export const REVIEW_LIMITS = {
  milliseconds: 15 * 60_000,
  tools: 64,
  steps: 48,
  reasoningTokens: 60_000,
  files: 150,
  changedLines: 12_000
} as const

export function reviewerPermissions(base: string, head: string, role: string): SkillGuardRule[] {
  if (![base, head].every((sha) => /^[0-9a-f]{40,64}$/i.test(sha))) throw new Error('Invalid pinned review commits.')
  return [
    // Deny unknown/plugin tools too: a write-capable MCP must not bypass read-only.
    { action: '*', resource: '*', effect: 'deny' },
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'read', resource: '*.env', effect: 'deny' },
    { action: 'read', resource: '*.env.*', effect: 'deny' },
    { action: 'read', resource: '*.env.example', effect: 'allow' },
    { action: 'question', resource: '*', effect: 'allow' },
    // No broad shell prefixes: Git options, interpreters and compound commands
    // must not turn an inspection permission into a write/verification escape.
    { action: 'shell', resource: `git diff --stat ${base} ${head}`, effect: 'allow' },
    { action: 'shell', resource: `git diff ${base} ${head}`, effect: 'allow' },
    { action: 'shell', resource: `git diff ${base} ${head} -- *`, effect: 'allow' },
    ...(role === 'sol' ? [{ action: 'skill', resource: 'sol-loop', effect: 'allow' as const }] : []),
    ...(role === 'impeccable' ? [{ action: 'skill', resource: 'impeccable', effect: 'allow' as const }] : [])
  ]
}

/** IDs make reconnect snapshots and live events idempotent, including parallel tools. */
export class ReviewerBudget {
  private steps = new Set<string>()
  private tools = new Set<string>()
  private reasoning = new Map<string, number>()
  private recordedReasoning = 0

  observe(event: RawEvent): void {
    const data = event.data
    if (!data || typeof data.assistantMessageID !== 'string') return
    const id = data.assistantMessageID
    if (event.type === 'session.step.started' || event.type === 'session.step.ended') this.steps.add(id)
    if (event.type === 'session.tool.called' && typeof data.id === 'string') this.tools.add(`${id}:${data.id}`)
    if (event.type === 'session.step.ended') {
      const tokens = data.tokens as { reasoning?: number } | undefined
      if (typeof tokens?.reasoning === 'number') this.reasoning.set(id, Math.max(this.reasoning.get(id) ?? 0, tokens.reasoning))
    }
  }

  restore(messages: Array<{
    id: string
    content: Array<{ type: string; id?: string }>
    tokens?: { reasoning: number }
  }>, reasoningTokens: number): void {
    for (const message of messages) {
      this.steps.add(message.id)
      for (const part of message.content) {
        if (part.type === 'tool' && part.id) this.tools.add(`${message.id}:${part.id}`)
      }
      this.reasoning.set(message.id, Math.max(this.reasoning.get(message.id) ?? 0, message.tokens?.reasoning ?? 0))
    }
    this.recordedReasoning = Math.max(this.recordedReasoning, reasoningTokens)
  }

  exhausted(): string | undefined {
    if (this.tools.size >= REVIEW_LIMITS.tools) return `${REVIEW_LIMITS.tools} tool calls`
    if (this.steps.size > REVIEW_LIMITS.steps) return `${REVIEW_LIMITS.steps} model turns`
    const reasoning = Math.max(this.recordedReasoning, [...this.reasoning.values()].reduce((total, count) => total + count, 0))
    if (reasoning >= REVIEW_LIMITS.reasoningTokens) return `${REVIEW_LIMITS.reasoningTokens.toLocaleString('en-US')} reasoning tokens`
    return undefined
  }
}
