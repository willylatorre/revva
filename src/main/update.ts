/**
 * "Is there a newer Revva?" — a read-only check against GitHub's release feed.
 *
 * Deliberately does not download or install anything. Mac builds are ad-hoc
 * signed (no Developer ID), and macOS will not apply an in-place update to an
 * ad-hoc-signed app, so an "Update now" button would fail on the platform most
 * users are on. What works everywhere is telling the truth and opening the
 * release page: the user downloads the DMG/NSIS and installs it as they did the
 * first time. Windows NSIS *could* self-update, but a button that silently
 * behaves differently per platform is worse than one honest download link.
 *
 * The network failure mode matters more than the happy path: this runs on
 * launch, often offline or behind a proxy, and must never surface as an error.
 */
import { app, net } from 'electron'
import { RECENT_RELEASES_API, RELEASE_NOTES_URL, isNewerVersion } from '@shared/releases'
import type { UpdateCheck } from '@shared/types'

interface ReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface Release {
  tag_name?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: ReleaseAsset[]
}

/** Prefer the installer people actually expect on this platform. */
function installerUrl(release: Release): string | undefined {
  const assets = (release.assets ?? []).filter((a) => typeof a.browser_download_url === 'string')
  const named = (pattern: RegExp): string | undefined =>
    assets.find((a) => pattern.test(String(a.name ?? '')))?.browser_download_url as string | undefined
  const preferred = process.platform === 'darwin'
    ? named(/\.dmg$/i) ?? named(/\.zip$/i)
    : named(/\.exe$/i) ?? named(/\.zip$/i) ?? named(/\.msi$/i)
  return preferred ?? (typeof release.html_url === 'string' ? release.html_url : undefined)
}

/** Highest stable version in the list — publish order is not version order. */
function newestRelease(releases: Release[]): Release | undefined {
  let best: Release | undefined
  let bestVersion = ''
  for (const release of releases) {
    if (release.draft === true || release.prerelease === true) continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    // Unparseable tags read as 0.0.0 and can never beat a real version.
    if (!tag || !isNewerVersion(tag, bestVersion)) continue
    best = release
    bestVersion = tag.replace(/^v/i, '')
  }
  return best
}

/** One check, no caching — callers decide how fresh they want it. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  const base: UpdateCheck = { current, available: false, checkedAt: Date.now() }
  try {
    // Electron's net module rides the app's proxy and certificate settings, which
    // a bare global fetch does not on an OS with an intercepted TLS chain.
    const res = await net.fetch(RECENT_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const payload = (await res.json()) as unknown
    const release = newestRelease(Array.isArray(payload) ? (payload as Release[]) : [])
    if (!release) throw new Error('No published releases were found.')
    const latest = String(release.tag_name).replace(/^v/i, '')
    // Running from source: the version is whatever package.json says, and a dev
    // build is never "behind" a release. Report the comparison, let the UI decide.
    const available = isNewerVersion(latest, current)
    return {
      ...base,
      latest,
      available,
      downloadUrl: available ? installerUrl(release) : undefined,
      notesUrl: available ? `${RELEASE_NOTES_URL}/v${latest}` : undefined
    }
  } catch (err) {
    // Offline, rate-limited, proxied, or GitHub itself down: say so once, quietly.
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
