/**
 * One place that decides where worktrees live.
 *
 * Everything sits under a single mandatory `worktreeRoot`:
 *
 *   <root>/repos/<owner>/<name>              review clones, cloned on first use
 *   <root>/worktrees/<owner>/<name>/<leaf>   worktrees of those review clones
 *   <root>/worktrees/local/<repo>/<leaf>     worktrees of the user's own checkouts
 *
 * One root, two namespaces, no guessing. The previous code had three unrelated
 * defaults that applied depending on the code path — `<repo>/../<repo>-worktrees`
 * for ticket work, `~/<home>-worktrees/gh-reviews/<owner>` for PR work, and
 * whatever OpenCode chose for service-managed worktrees — which scattered a single
 * user's work across three directory trees.
 *
 * Worktrees never live inside a checkout: a nested worktree makes repo-wide tooling
 * walk into other branches' files (ruff, pyright extraPaths, pytest testpaths and
 * ripgrep all do), which is why these repos gitignore `.claude/worktrees/`.
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { settingGet } from './db'

/**
 * The setting is typed by hand, so `~` and a trailing slash are accepted: the error
 * message below suggests `~/revva`, and a `~` that stayed literal would resolve to a
 * folder named `~` inside the app's working directory instead of the home folder.
 */
function root(): string {
  const value = settingGet<string>('worktreeRoot')
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      'Set the worktree root in Setup first (for example ~/revva). Revva keeps review clones and per-task worktrees under it.'
    )
  }
  const expanded = value.trim().replace(/^~(?=$|[\\/])/, homedir())
  if (!isAbsolute(expanded)) {
    throw new Error(
      `The worktree root must be an absolute path (got "${value.trim()}"). Set it in Setup → Projects, for example ~/revva.`
    )
  }
  return expanded.replace(/[\\/]+$/, '') || expanded
}

/** Root holding every review clone, `<root>/repos`. Not created here. */
export function reviewRoot(): string {
  return join(root(), 'repos')
}

/** Directory holding `owner/name`'s review clones. Created on demand. */
export function reviewClonesDir(owner: string): string {
  const dir = join(reviewRoot(), owner)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Same path without creating anything, for read-only probes (`stackForPr` looks for
 * a clone that may not exist yet and must not create an empty directory to find that out).
 */
export function reviewClonesPath(owner: string): string {
  return join(reviewRoot(), owner)
}

/**
 * Directory holding the worktrees of `repoDir`. A review clone (one living under
 * `<root>/repos/<owner>/<name>`) is addressed by its owner/name; any other checkout
 * is addressed by its folder name under the `local` namespace. The check is an exact
 * prefix against the configured root, not a search for a `repos` path segment, so a
 * personal checkout that happens to sit in a folder named `repos` is not mistaken
 * for a review clone.
 */
export function worktreesDirFor(repoDir: string): string {
  const repos = reviewRoot()
  if (repoDir === repos || repoDir.startsWith(`${repos}/`) || repoDir.startsWith(`${repos}\\`)) {
    const relative = repoDir.slice(repos.length).split(/[\\/]+/).filter(Boolean)
    if (relative.length >= 2) return join(root(), 'worktrees', relative[0]!, relative[1]!)
  }
  return join(root(), 'worktrees', 'local', basename(repoDir))
}
