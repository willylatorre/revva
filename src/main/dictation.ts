/**
 * Detection of third-party dictation apps (Hex, Wispr Flow). They are global
 * hotkey tools — Revva never launches or controls them, it only finds out
 * whether one exists on this machine so the composer can hint that dictating
 * into the message box works. Presence checks only: file existence, no exec.
 */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { DictationApp } from '@shared/types'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Where each known dictation app lives per-OS (verified against their installers). */
function candidatePaths(app: DictationApp): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  if (process.platform === 'darwin') {
    // Hex ships anomaly.hex, Wispr Flow com.electron.wispr-flow; both drag into /Applications.
    const dirs = app === 'hex' ? ['Hex.app'] : ['Wispr Flow.app', 'Whisper Flow.app']
    return dirs.flatMap((dir) => [`/Applications/${dir}`, join(home, 'Applications', dir)])
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? ''
    if (app === 'hex') {
      // Per-user Inno install: %APPDATA%\hex with current-version / install.json receipts.
      return [join(appData, 'hex', 'current-version'), join(appData, 'hex', 'install.json')]
    }
    // Wispr Flow: MSI into Program Files, per-user Setup.exe keeps state in %APPDATA%.
    return [join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Wispr Flow'), join(appData, 'Wispr Flow')]
  }
  // Hex on Linux: .deb/.rpm into standard prefixes, install script into ~/.local/bin.
  if (app !== 'hex') return []
  return ['/usr/bin/hex', '/usr/local/bin/hex', join(home, '.local', 'bin', 'hex')]
}

/** Installed dictation apps, in hint-preference order. Cheap enough to re-run on focus. */
export async function detectDictationApps(): Promise<DictationApp[]> {
  const apps: DictationApp[] = ['hex', 'wispr-flow']
  const present = await Promise.all(
    apps.map(async (app) => {
      const paths = candidatePaths(app)
      return (await Promise.all(paths.map(exists))).some(Boolean) ? app : null
    })
  )
  return present.filter((app): app is DictationApp => app !== null)
}
