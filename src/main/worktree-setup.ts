/**
 * Per-worktree environment provisioning.
 *
 * A ticket worktree is a bare `git worktree add`: it holds tracked files and
 * nothing else — no `.venv`, no `node_modules`, no installed dependencies. Tests,
 * linters, and pre-push hooks then have nothing to run in, and an agent either
 * skips verification or reports checks it never ran.
 *
 * Reusing the main checkout's environment is NOT a fix, it is the trap: a venv's
 * editable installs resolve to the main tree, so the worktree's test run silently
 * exercises the *other* branch's code and fails (or passes) for the wrong reason.
 *
 * So each workspace names one opaque command that builds a fresh environment in
 * the new worktree. Revva runs it verbatim through the platform shell — same
 * contract as Scripts: Revva does not model what the command does.
 */
import { execTool } from './toolchain'
import { describeError } from './opencode/service'

/** Dependencies can take minutes to build (compilers, wheels); generous but bounded. */
const SETUP_TIMEOUT_MS = 30 * 60_000

export interface SetupCommandResult {
  ok: boolean
  /** The command's own combined output, tail-trimmed for display. */
  output: string
}

/** Last `lines` lines of the combined output — enough to diagnose without flooding the UI. */
function tail(text: string, lines = 40): string {
  const all = text.trim().split('\n')
  return all.slice(Math.max(0, all.length - lines)).join('\n').trim()
}

/**
 * Run `command` in `cwd` through the user's shell, so aliases and functions from
 * their rc files work exactly as they do in a terminal (and as Scripts do).
 * Resolves with the outcome instead of throwing: a failed setup is a state the
 * work card reports, not an exception the caller has to unwind.
 */
export async function runSetupCommand(command: string, cwd: string): Promise<SetupCommandResult> {
  const trimmed = command.trim()
  if (!trimmed) return { ok: true, output: '' }
  const [file, args]: [string, string[]] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-Command', trimmed]]
    : ['/bin/zsh', ['-c', trimmed]]
  try {
    // execFile captures both streams; these tools report progress on stderr and errors there too.
    const res = await execTool(file, args, { cwd, timeout: SETUP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    return { ok: true, output: tail([res.stdout, res.stderr].join('\n')) }
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message?: string }
    // execTool folds stderr into the message already; show whichever has content.
    const message = describeError(err)
    const streams = [failure.stdout ?? '', failure.stderr ?? ''].join('\n').trim()
    const detail = message.includes(streams) || !streams ? message : `${message}\n${streams}`
    return { ok: false, output: tail(detail) }
  }
}
