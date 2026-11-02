/**
 * Read-only detection of a *second* Atlassian MCP connection in the user's OpenCode config
 * (the harness signing in separately, e.g. `"mcp": { "atlassian": { "oauth": {} } }`).
 *
 * The bridge shadows such an entry in every checkout Revva registers, so this is never a
 * functional conflict — it is a stale second consent worth pointing out once. We only parse;
 * Revva never writes OpenCode's config. Any parse failure reports "no duplicate" (fail-open):
 * a missed hint beats a false alarm about a file we could not read.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Strips // and /* * / comments, then trailing commas — enough for detection, not a full JSONC parser. */
function stripJsonc(text: string): string {
  return text
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ' '))
    .replace(/,\s*([}\]])/g, '$1')
}

function atlassianEntryEnabled(file: string): boolean {
  try {
    const parsed = JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) as { mcp?: Record<string, { enabled?: boolean }> }
    const entry = parsed.mcp?.atlassian
    return !!entry && entry.enabled !== false
  } catch {
    return false
  }
}

/**
 * Config files (global and per-checkout) that declare an enabled Atlassian MCP server with
 * its own connection. Returned paths are for display in Setup only.
 */
export function findDuplicateAtlassianConfigs(directories: string[]): string[] {
  const configHome = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
  const candidates = [
    join(configHome, 'opencode.json'),
    join(configHome, 'opencode.jsonc'),
    ...directories.flatMap((dir) => [
      join(dir, 'opencode.json'),
      join(dir, 'opencode.jsonc'),
      join(dir, '.opencode', 'opencode.json'),
      join(dir, '.opencode', 'opencode.jsonc')
    ])
  ]
  return [...new Set(candidates)].filter((file) => existsSync(file) && atlassianEntryEnabled(file))
}
