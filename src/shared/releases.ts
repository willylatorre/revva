/**
 * Where Revva's own releases live.
 *
 * The app is distributed from this one public repository (see the release
 * workflow), so the update check reads GitHub's release feed directly — no
 * account, no token, no private endpoint. Centralized here so the Setup panel,
 * the changelog dialog and the main-process check cannot drift apart.
 */
export const RELEASE_REPO = 'willylatorre/revva'

/** Human-facing pages. */
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`
export const RELEASE_NOTES_URL = `${RELEASES_URL}/tag`

/**
 * GitHub's recently-published releases. Not `/releases/latest`: that returns the
 * most recently *published* release, and CI publishes platforms independently —
 * a slow macOS runner can land v1.12.0 after v1.13.0, which would make an older
 * version look newest. Reading a page and taking the highest version is immune to
 * publish order.
 */
export const RECENT_RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`

/** `1.12.0`, `v1.12.0`, `1.12.0-beta.1` → `[1, 12, 0]`. Anything unparseable reads as 0.0.0. */
export function versionParts(version: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]
}

/** True when `candidate` is a strictly newer release than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate)
  const b = versionParts(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!
  }
  return false
}
