/**
 * Jira rich-text flattening.
 *
 * `responseContentFormat: markdown` is *advisory* in Atlassian MCP v2: the server downgrades to
 * HTML whenever the content holds nodes markdown cannot represent (inline media, panels,
 * @mentions) and only says so in the payload's `appliedContentFormat`/`warning`. Bodies
 * therefore arrive as HTML on modern sites, ADF on legacy content, markdown where it stuck —
 * so sniff all three instead of trusting the format we asked for.
 * (The `{ data: … }` envelope v2 adds is stripped in mcp.ts, where results are parsed.)
 */
import { collectAdfText } from '../util'

/** True for anything carrying element tags (as opposed to markdown or plain text). */
function isHtml(value: string): boolean {
  return /<[a-z!/][^>]*>/i.test(value)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–'
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/**
 * HTML → Markdown for Jira bodies: headings, lists, links, code, line breaks; everything else
 * flattens to text. Attached media carries no readable text, so a figure becomes a blank line
 * rather than a wall of `data-*` attributes.
 */
export function htmlToMarkdown(html: string): string {
  const flat = (fragment: string): string => decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  const text = html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const name = flat(label)
      return name && name !== href ? `${name} (${href})` : href
    })
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => `\n\`\`\`\n${flat(body)}\n\`\`\`\n`)
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n${'#'.repeat(Math.min(6, Number(level)))} `)
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr|pre)>/gi, '\n')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A Jira rich-text body (description or comment) → readable text. `join` glues ADF's separate
 * text nodes: descriptions keep newlines, comments read as prose.
 */
export function jiraBodyToText(body: unknown, join = '\n'): string {
  if (typeof body === 'string') return isHtml(body) ? htmlToMarkdown(body) : body.trim()
  if (body && typeof body === 'object') return collectAdfText(body).join(join).trim()
  return ''
}
