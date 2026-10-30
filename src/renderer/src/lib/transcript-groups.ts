import type { ChatMessage } from '@shared/types'

export type TranscriptGroup = { kind: 'user'; msg: ChatMessage } | { kind: 'assistant'; msgs: ChatMessage[] }

/** Collapse consecutive assistant messages (one per agent-loop step) into a single
 *  turn group, so a chain of tool calls reads as one thought process, not N bubbles. */
export function groupRows(rows: ChatMessage[]): TranscriptGroup[] {
  const out: TranscriptGroup[] = []
  for (const m of rows) {
    if (m.role === 'user') out.push({ kind: 'user', msg: m })
    else {
      const last = out[out.length - 1]
      if (last?.kind === 'assistant') last.msgs.push(m)
      else out.push({ kind: 'assistant', msgs: [m] })
    }
  }
  return out
}

function groupKey(group: TranscriptGroup): string | undefined {
  return group.kind === 'user' ? group.msg.id : group.msgs[0]?.id
}

/** Carry previous group identities forward while every member message is still
 *  the same object, so streaming batches don't hand memoized cards fresh arrays.
 *  Bounded to the current transcript: both inputs are capped upstream. */
export function stabilizeGroups(previous: TranscriptGroup[], rows: ChatMessage[]): TranscriptGroup[] {
  const fresh = groupRows(rows)
  if (previous.length === 0) return fresh
  const byKey = new Map<string, TranscriptGroup>()
  for (const group of previous) {
    const key = groupKey(group)
    if (key && !byKey.has(key)) byKey.set(key, group)
  }
  const used = new Set<TranscriptGroup>()
  return fresh.map((group) => {
    const key = groupKey(group)
    if (!key) return group
    const old = byKey.get(key)
    if (!old || old.kind !== group.kind || used.has(old)) return group
    if (group.kind === 'user' && old.kind === 'user') {
      if (old.msg !== group.msg) return group
    } else if (group.kind === 'assistant' && old.kind === 'assistant') {
      if (old.msgs.length !== group.msgs.length) return group
      if (!group.msgs.every((message, i) => message === old.msgs[i])) return group
    } else {
      return group
    }
    used.add(old)
    return old
  })
}
