/**
 * Composer token → OpenCode prompt attachments. The renderer tokenizes the
 * message text and reports byte offsets; we pass them through as `mention` so
 * OpenCode links `/skill`, `@file` and `#agent` tokens to their attachments.
 */
import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import { toToolPath } from '../toolchain'
import type { PromptRefs } from '@shared/types'

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s)

export function skillAttachments(refs: PromptRefs): Array<{ id: string; mention: { start: number; end: number; text: string } }> {
  return refs.skills.map((s) => ({ id: s.id, mention: { start: s.start, end: s.end, text: clip(s.text, 300) } }))
}

/** Explicit #agent tokens reference discovered profiles, without switching the coordinator. */
export function agentAttachments(refs: PromptRefs): Array<{ name: string; mention: { start: number; end: number; text: string } }> {
  return (refs.agents ?? []).map((agent) => ({ name: agent.id, mention: { start: agent.start, end: agent.end, text: clip(agent.text, 300) } }))
}

/** @file refs become file:// attachments rooted at the session's working directory. */
export function fileAttachments(refs: PromptRefs, directory: string): Array<{ uri: string; name: string; mention: { start: number; end: number; text: string } }> {
  return refs.files
    .map((f) => {
      const abs = f.path.startsWith('/') ? f.path : join(directory, f.path)
      return { f, abs }
    })
    // Typing is unvalidated: an email or a typo must not fail the whole prompt.
    .filter(({ abs }) => existsSync(abs))
    .map(({ f, abs }) => ({
      // The service resolves these URIs, so the path must be in its own space.
      uri: fileUri(toToolPath(abs)),
      name: basename(abs),
      mention: { start: f.start, end: f.end, text: clip(f.text, 300) }
    }))
}

/** `file://` URI for a path in either shape, with the reserved characters escaped. */
function fileUri(path: string): string {
  return `file://${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}
