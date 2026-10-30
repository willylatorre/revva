/**
 * Conservative boundary scan for streaming assistant Markdown (plan 018).
 *
 * Settled blocks are handed back only when every split point is a blank line
 * the CommonMark block parser provably closes its block at: never inside an
 * open fence, never inside a blockquote or list that could absorb the next
 * line, and never in front of an indented block. Anything document-wide —
 * link reference definitions, footnote definitions, raw HTML blocks — or any
 * construct this scan does not model disables the split entirely so callers
 * fall back to a whole-document parse.
 *
 * Over-grouping is safe: each settled source is re-parsed by the real parser,
 * so grouping extra lines together renders identically. Only splitting where
 * the real parser would keep one block could corrupt the render, which is why
 * every ambiguity delays a boundary instead of risking one. The boundary scan
 * itself still visits the whole document per call — this is not O(delta).
 */

const BLANK_LINE = /^[ \t]*$/
const BLOCKQUOTE_LINE = /^ {0,3}>/
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/
/** Any indentation of a fence opener inside a container: the container-close
 *  rules below do not model lazy continuations around code, so fall back. */
const FENCE_INSIDE = /^\s*(```|~~~)/
const QUOTE_FENCE = /^ {0,3}>(?:\s*>)*\s*(```|~~~)/
const BULLET_ITEM = /^( *)([-+*])(?:[ \t]|$)/
const ORDERED_ITEM = /^( *)(\d{1,9})([.)])(?:[ \t]|$)/
/** Link reference and footnote definitions resolve across the whole document.
 *  Checked at any indent: a false positive only costs a full re-parse. */
const DEFINITION = /^\s*\[[^\]]*\]:[ \t]*\S?/
/** Raw HTML block openers (react-markdown escapes them, but the block parser
 *  still swallows following lines, so a split inside one could diverge). */
const HTML_BLOCK = /^\s*<(?:[A-Za-z][A-Za-z0-9-]*(?=[ \t/>]|$)|\/[A-Za-z][A-Za-z0-9-]*\s*>|[!?])/

export interface StreamingMarkdownSplit {
  /** Whole top-level blocks in document order; their sources stop changing
   *  while the answer only appends. Empty when no boundary is provable yet. */
  blocks: string[]
  /** Everything after the last provable boundary; re-parsed on each update. */
  tail: string
}

interface ListMarker {
  contentIndent: number
  contentStartsWithFence: boolean
}

function indentOf(line: string): number {
  let n = 0
  while (n < line.length) {
    const char = line[n]
    if (char === ' ') n += 1
    else if (char === '\t') return 8 // tabs: ambiguous — never settle on them
    else break
  }
  return n
}

function nextContent(lines: string[], from: number): number | null {
  for (let i = from; i < lines.length; i += 1) if (!BLANK_LINE.test(lines[i]!)) return i
  return null
}

function listMarker(line: string): ListMarker | null {
  const bullet = BULLET_ITEM.exec(line)
  const ordered = bullet ? null : ORDERED_ITEM.exec(line)
  if (!bullet && !ordered) return null
  const spaces = (bullet?.[1] ?? ordered![1]!).length
  const markerLength = bullet ? 1 : ordered![2]!.length + ordered![3]!.length
  const body = line.slice(spaces + markerLength)
  const after = /^[ \t]*/.exec(body)![0]!.length
  const rest = body.slice(after)
  // Spec: 1–3 spaces after the marker widen the content indent, 4+ start a
  // code block at marker+1, and an empty item's content sits at marker+1.
  const contentIndent = spaces + markerLength + (after >= 4 || after === 0 ? 1 : after)
  return { contentIndent, contentStartsWithFence: /^(```|~~~)/.test(rest) }
}

function findFenceClose(lines: string[], from: number, fence: string): number | null {
  const close = new RegExp(`^ {0,3}${fence[0]!}{${fence.length},}[ \\t]*$`)
  for (let i = from; i < lines.length; i += 1) if (close.test(lines[i]!)) return i
  return null
}

/**
 * Returns null only for document-wide constructs (fallback to whole-document
 * rendering). Otherwise `blocks` are settled top-level sources and `tail` is
 * the mutable remainder; an empty `blocks` simply means "not settled yet".
 */
export function splitStreamingMarkdown(source: string): StreamingMarkdownSplit | null {
  const lines = source.split('\n')
  const blocks: string[] = []
  let blockStart = 0
  let inQuote = false
  let inList = false
  let listContentIndent = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    // Definitions and raw HTML blocks change how later lines parse no matter
    // where the split lands. (Fenced code is skipped by the index jump below,
    // where such lines are literal and safe.)
    if (DEFINITION.test(line) || HTML_BLOCK.test(line)) return null

    if (inQuote) {
      if (QUOTE_FENCE.test(line)) return null
      if (BLOCKQUOTE_LINE.test(line)) { i += 1; continue }
      if (BLANK_LINE.test(line)) {
        const next = nextContent(lines, i + 1)
        if (next === null) break // trailing blanks: quote unclosed for now
        if (BLOCKQUOTE_LINE.test(lines[next]!)) { i = next; continue }
        inQuote = false // blank lines end lazy continuation, so this quote closed
        if (indentOf(lines[next]!) < 4) {
          if (i > blockStart) blocks.push(lines.slice(blockStart, i).join('\n'))
          blockStart = next
          i = next
        }
        continue // otherwise let the top-level pass look at the same blank
      }
      i += 1 // lazy paragraph continuation keeps the quote open
      continue
    }

    if (inList) {
      if (FENCE_INSIDE.test(line)) return null
      if (BLANK_LINE.test(line)) {
        const next = nextContent(lines, i + 1)
        if (next === null) break
        const nextLine = lines[next]!
        if (indentOf(nextLine) >= listContentIndent) { i += 1; continue } // item content or code block
        if (listMarker(nextLine)) { i += 1; continue } // sibling (or a regrouped new list)
        if (BLOCKQUOTE_LINE.test(nextLine)) {
          if (indentOf(nextLine) >= 4) { i += 1; continue } // code block: keep the list open
          inList = false // a quote at column < content closes the list
          if (i > blockStart) blocks.push(lines.slice(blockStart, i).join('\n'))
          blockStart = next
          i = next
          continue
        }
        if (indentOf(nextLine) < 4) {
          inList = false
          blocks.push(lines.slice(blockStart, i).join('\n'))
          blockStart = next
          i = next
        } else {
          // Indented deeper than the content column but ≥4: spec-closed, but
          // ambiguous enough to keep the list open and delay settling.
          i += 1
        }
        continue
      }
      i += 1 // continuation, nested content, or a sibling marker: list stays open
      continue
    }

    if (BLANK_LINE.test(line)) {
      const next = nextContent(lines, i + 1)
      if (next === null) break
      if (indentOf(lines[next]!) < 4) {
        if (i > blockStart) blocks.push(lines.slice(blockStart, i).join('\n'))
        blockStart = next
        i = next
      } else {
        i += 1 // an indented block may belong to a container we didn't settle in
      }
      continue
    }
    if (indentOf(line) >= 4) { i += 1; continue } // top-level indented code line

    const fence = FENCE_START.exec(line)
    if (fence) {
      const closedAt = findFenceClose(lines, i + 1, fence[1]!)
      if (closedAt === null) break // unclosed fence: the rest is the mutable tail
      i = closedAt + 1
      continue
    }
    if (BLOCKQUOTE_LINE.test(line)) { inQuote = true; i += 1; continue }
    const marker = listMarker(line)
    if (marker) {
      if (marker.contentStartsWithFence) return null
      inList = true
      listContentIndent = marker.contentIndent
      i += 1
      continue
    }
    i += 1 // paragraph, heading, table row, …: a top-level blank closes it
  }
  return { blocks, tail: lines.slice(blockStart).join('\n') }
}
