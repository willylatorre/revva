import { basename } from 'node:path'
import { execTool } from './toolchain'
import type { ChatRepoStatus } from '@shared/types'

const exec = execTool

/** Inspect the checkout that a chat session uses. */
export async function chatRepoStatus(directory: string): Promise<ChatRepoStatus> {
  let repoDir: string
  try {
    const result = await exec('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { timeout: 10_000 })
    repoDir = result.stdout.trim()
    if (!repoDir) throw new Error('Git returned no repository path.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/not a git repository/i.test(message)) throw error
    return { directory, repoDir: null, repoName: null, branch: null, changedFiles: null }
  }

  const [branchResult, statusResult] = await Promise.all([
    exec('git', ['-C', repoDir, 'branch', '--show-current'], { timeout: 10_000 }),
    exec('git', ['-C', repoDir, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  ])
  const entries = statusResult.stdout.split('\0')
  let changedFiles = 0
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry) continue
    changedFiles++
    if (entry.slice(0, 2).includes('R') || entry.slice(0, 2).includes('C')) index++
  }
  return {
    directory,
    repoDir,
    repoName: basename(repoDir),
    branch: branchResult.stdout.trim() || null,
    changedFiles
  }
}
