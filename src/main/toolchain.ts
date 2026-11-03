/**
 * Command environment: where Revva looks for `git`, `gh` and `opencode`, and
 * which path space those tools speak.
 *
 * Revva's own database, UI and filesystem checks always use **Windows paths**.
 * A WSL toolchain sees the same files as `/mnt/c/...` (drives) or `/home/...`
 * (its own filesystem), so every path that crosses into a tool or into the
 * OpenCode service is translated, and every path that comes back is translated
 * to the Windows form. Nothing is guessed: an unrepresentable path is passed
 * through unchanged so the tool reports the real failure.
 *
 * The choice is one setting shared by every tool (`toolchain.environment`):
 *
 *   { kind: 'native' }                      Windows PATH (default)
 *   { kind: 'wsl', distro: 'Ubuntu' }       a WSL distribution
 *   { kind: 'custom', prefix: ['wsl.exe'] } an explicit launch prefix, no translation
 *
 * A custom prefix runs the tool with the prefix in front of its arguments and
 * gets no path translation — it is the escape hatch for an unusual launcher
 * Revva cannot model, and the UI says so.
 */
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolchainChoice, ToolchainProbe } from '@shared/types'
import { settingGet, settingSet } from './db'

export const TOOLCHAIN_SETTING = 'toolchain.environment'

const isWindows = process.platform === 'win32'

/** Cached discovery per distro; a distro rarely changes under a running app. */
const mountRoots = new Map<string, string>()
const resolved = new Map<string, string | undefined>()
/** Distro list, cached until the environment changes. */
let distroList: string[] | undefined
/** Name Windows uses for `\\wsl.localhost\<name>` when no distro was chosen. */
let defaultDistroName = ''

/** Read and validate the stored choice. Anything unusable falls back to native. */
export function choice(): ToolchainChoice {
  const raw = settingGet<unknown>(TOOLCHAIN_SETTING)
  if (!raw || typeof raw !== 'object') return { kind: 'native' }
  const value = raw as { kind?: unknown; distro?: unknown; prefix?: unknown }
  if (value.kind === 'wsl') {
    const distro = typeof value.distro === 'string' ? value.distro.trim() : ''
    // An empty distro means "the default distribution", which WSL resolves itself.
    return { kind: 'wsl', distro }
  }
  if (value.kind === 'custom') {
    const prefix = Array.isArray(value.prefix)
      ? value.prefix.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      : []
    if (prefix.length) return { kind: 'custom', prefix }
  }
  return { kind: 'native' }
}

export function setChoice(next: ToolchainChoice): void {
  settingSet(TOOLCHAIN_SETTING, next)
  // Every cached derivation belongs to the previous environment.
  resolved.clear()
  mountRoots.clear()
  distroList = undefined
  defaultDistroName = ''
}

export function labelFor(c: ToolchainChoice): string {
  if (c.kind === 'native') return 'Windows (native)'
  if (c.kind === 'wsl') return c.distro ? `WSL — ${c.distro}` : 'WSL — default distribution'
  return `Custom — ${c.prefix.join(' ')}`
}

/* ---------------- WSL discovery ---------------- */

function wslArgs(distro: string, args: string[]): string[] {
  return [...(distro ? ['-d', distro] : []), ...args]
}

function runWsl(distro: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('wsl.exe', wslArgs(distro, args), { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: typeof stdout === 'string' ? stdout.replace(/^\uFEFF/, '') : String(stdout ?? ''),
        err: (typeof stderr === 'string' ? stderr : String(stderr ?? '')) || (err ? err.message : '')
      })
    })
  })
}

/** `wsl.exe -l -q` answers UTF-16LE with NUL bytes between characters. */
function decodeDistroList(raw: string): string[] {
  const cleaned = raw.replace(/\u0000/g, '').replace(/\uFEFF/g, '')
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[A-Za-z]:\\/.test(line))
}

export async function listDistros(): Promise<string[]> {
  if (!isWindows) return []
  if (distroList) return distroList
  const res = await runWsl('', ['-l', '-q'], 10_000)
  distroList = res.ok ? decodeDistroList(res.out) : []
  return distroList
}

/**
 * Where this drive appears inside the distro. WSL defaults to `/mnt/<letter>`
 * but `wsl.conf` can move it, so ask the distro once instead of assuming.
 */
async function mountRootOf(distro: string): Promise<string> {
  const cached = mountRoots.get(distro)
  if (cached) return cached
  const res = await runWsl(distro, ['-e', 'wslpath', '-u', 'C:\\'])
  const out = res.out.trim()
  // Expect "/mnt/c/" — keep everything up to and including the letter.
  const match = out.match(/^(.*\/[a-z])\/?$/i)
  const root = match ? match[1]! : '/mnt/c'
  // Normalise to the directory that holds the letter, e.g. "/mnt".
  const base = root.slice(0, root.length - 2) || '/mnt'
  mountRoots.set(distro, base)
  return base
}

/* ---------------- path translation ---------------- */

const DRIVE_ABSOLUTE = /^([A-Za-z]):[\\/](.*)$/
const UNCASED_ABSOLUTE = /^\\\\\?\\[A-Za-z]:[\\/]/
const UNC_ABSOLUTE = /^\\\\[^\\]+\\[^\\]+\\?/

function isWindowsAbsolute(value: string): boolean {
  return DRIVE_ABSOLUTE.test(value) || UNCASED_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value)
}

/**
 * Resolve the drive mount point of the chosen distro once, before any path is
 * translated. Translation itself is synchronous because event payloads are
 * handled in arrival order and must not be reordered by awaits.
 */
export async function primePaths(): Promise<void> {
  const c = choice()
  if (c.kind !== 'wsl') return
  await Promise.all([mountRootOf(c.distro), distroName(c.distro)])
}

/** The name Windows uses for `\\wsl.localhost\<name>`, resolved for the default distro. */
async function distroName(distro: string): Promise<string> {
  if (distro) return distro
  const cached = defaultDistroName
  if (cached) return cached
  const res = await runWsl('', ['-e', 'sh', '-c', 'printf %s "${WSL_DISTRO_NAME:-}"'])
  const name = res.ok ? res.out.trim() : ''
  defaultDistroName = name
  return name
}

/** Windows → toolchain. Identity unless the toolchain is WSL. */
export function toToolPath(value: string): string {
  const c = choice()
  if (c.kind !== 'wsl' || !value) return value
  return windowsToWsl(c.distro, value)
}

/** Toolchain → Windows. Identity unless the toolchain is WSL. */
export function fromToolPath(value: string): string {
  const c = choice()
  if (c.kind !== 'wsl' || !value) return value
  return wslToWindows(c.distro, value)
}

/** Cached mount base; `/mnt` is the WSL default and a safe pre-prime guess. */
function mountBaseOf(distro: string): string {
  return mountRoots.get(distro) ?? '/mnt'
}

function windowsToWsl(distro: string, value: string): string {
  const normal = value.replace(UNCASED_ABSOLUTE, (m) => m.slice(4))
  const drive = normal.match(DRIVE_ABSOLUTE)
  if (drive) {
    const rest = drive[2]!.replace(/\\/g, '/')
    return `${mountBaseOf(distro)}/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`
  }
  // `\\wsl.localhost\<distro>\home\me` and `\\wsl$\<distro>\...` return to the
  // distro filesystem form; any other UNC path is not representable there.
  const wslShare = normal.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\(.*)$/i)
  if (wslShare) return `/${wslShare[1]!.replace(/\\/g, '/')}`
  return value
}

function wslToWindows(distro: string, value: string): string {
  if (!value.startsWith('/')) return value
  const base = mountBaseOf(distro)
  const drive = value.match(new RegExp(`^${escapeRegExp(base)}/([a-z])(?:/(.*))?$`, 'i'))
  if (drive) {
    const rest = (drive[2] ?? '').replace(/\//g, '\\')
    return rest ? `${drive[1]!.toUpperCase()}:\\${rest}` : `${drive[1]!.toUpperCase()}:\\`
  }
  // Anything else lives on the distro's own filesystem, which Windows reaches
  // through the \\wsl.localhost share. The default distro resolves its own name
  // during priming, so this uses the real host rather than a placeholder.
  const host = distro || defaultDistroName || 'wsl'
  return `\\\\wsl.localhost\\${host}\\${value.slice(1).replace(/\//g, '\\')}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ---------------- tool resolution ---------------- */

/**
 * Absolute path of a tool inside the distro. A login shell is required because
 * version managers (nvm, asdf, volta) only put their shims on PATH there; a
 * non-interactive `wsl.exe` call would not find `opencode` at all.
 */
export async function resolveTool(name: string): Promise<string | undefined> {
  const c = choice()
  if (c.kind !== 'wsl') return undefined
  const key = `${c.distro}\u0000${name}`
  if (resolved.has(key)) return resolved.get(key)
  // A login shell is required because version managers (nvm, asdf, volta) only
  // put their shims on an interactive PATH. Distros without bash fall back to sh.
  const viaBash = await runWsl(c.distro, ['-e', 'bash', '-ic', 'command -v "$1"', 'bash', name])
  const res = viaBash.ok ? viaBash : await runWsl(c.distro, ['-e', 'sh', '-lc', 'command -v "$1"', 'sh', name])
  const found = res.ok ? res.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/')).at(-1) : undefined
  resolved.set(key, found)
  return found
}

/* ---------------- spawning ---------------- */

export interface SpawnSpec {
  file: string
  args: string[]
  /** Extra environment for the spawned process. */
  env?: Record<string, string>
  /** The invocation as a human would type it, for error messages. */
  display: string
}

/**
 * Turn a tool invocation into the process Revva must start.
 *
 * Args are translated only where they are provably paths: a drive-letter
 * absolute path, or a `\\wsl...` UNC path. Free-text option values (`--body`,
 * `--title`, commit messages) are declared in `TEXT_OPTIONS` and never touched,
 * so prose that happens to mention `C:\` survives verbatim.
 */
export async function spawnSpec(
  tool: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<SpawnSpec> {
  const c = choice()
  if (c.kind === 'native') {
    const shim = await nativeShim(tool)
    // A `.cmd` shim runs through cmd.exe, which takes the rest of the line as
    // one command string. Only `opencode` reaches this branch, and its arguments
    // are plain identifiers (`serve --service`), so the simple quoting is exact.
    return shim
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${shim}" ${args.join(' ')}`], env: options.env, display: [tool, ...args].join(' ') }
      : { file: tool, args, env: options.env, display: [tool, ...args].join(' ') }
  }

  if (c.kind === 'custom') {
    return {
      file: c.prefix[0]!,
      args: [...c.prefix.slice(1), tool, ...args],
      env: options.env,
      display: [tool, ...args].join(' ')
    }
  }

  const binary = (await resolveTool(tool)) ?? tool
  const translated = translateArgs(args)
  const cwd = options.cwd ? toToolPath(options.cwd) : ''
  const env = options.env ?? {}
  const script = [
    'if [ -n "$1" ]; then XDG_STATE_HOME="$1"; export XDG_STATE_HOME; fi',
    'cwd=$2',
    'shift 2',
    'if [ -n "$cwd" ]; then cd "$cwd" || exit 1; fi',
    'exec "$@"'
  ].join('; ')
  return {
    file: 'wsl.exe',
    args: [...(c.distro ? ['-d', c.distro] : []), '-e', 'sh', '-c', script, 'sh', env.XDG_STATE_HOME ?? '', cwd, binary, ...translated],
    display: [tool, ...args].join(' ')
  }
}

/* ---------------- native Windows shims ---------------- */

/**
 * Node cannot spawn `.cmd`/`.bat` without a shell (CVE-2024-27980), so a native
 * npm-installed `opencode.cmd` needs `cmd.exe` in front of it. Only `opencode`
 * gets this treatment: `gh` and `git` ship as real `.exe` files on Windows, and
 * quoting arbitrary arguments through cmd.exe would corrupt PR bodies.
 */
const nativeShims = new Map<string, string | undefined>()

/** Absolute path of a native `opencode.cmd`/`.bat` shim, when there is no `.exe`. */
async function nativeShim(tool: string): Promise<string | undefined> {
  if (!isWindows || tool !== 'opencode') return undefined
  if (nativeShims.has(tool)) return nativeShims.get(tool)
  const res = await runNative('where.exe', [tool])
  const found = res.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const shim = found.some((path) => /\.exe$/i.test(path))
    ? undefined
    : found.find((path) => /\.(cmd|bat)$/i.test(path))
  nativeShims.set(tool, shim)
  return shim
}

/**
 * Option flags whose value is user prose, never a path. Only flags Revva itself
 * passes are listed; `--body-file` is a path and is deliberately absent.
 */
const TEXT_OPTIONS = new Set(['--body', '--title', '--field', '--jq', '-m'])

function translateArgs(args: string[]): string[] {
  const out: string[] = []
  let skipNext = false
  for (const arg of args) {
    if (skipNext) {
      out.push(arg)
      skipNext = false
      continue
    }
    if (TEXT_OPTIONS.has(arg)) {
      out.push(arg)
      skipNext = true
      continue
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      // `--body=...` and friends carry prose after the first `=`.
      const eq = arg.indexOf('=')
      const flag = arg.slice(0, eq)
      if (TEXT_OPTIONS.has(flag)) {
        out.push(arg)
        continue
      }
    }
    if (isWindowsAbsolute(arg)) {
      out.push(toToolPath(arg))
      continue
    }
    out.push(arg)
  }
  return out
}

/**
 * Environment variables WSL must forward to the Linux process. The OpenCode
 * client hands the terminal handoff to the service through the environment,
 * and WSL drops variables that are not named in `WSLENV`.
 */
export function prepareProcessEnv(): void {
  if (choice().kind !== 'wsl') return
  const current = process.env.WSLENV ? process.env.WSLENV.split(':') : []
  for (const name of ['OPENCODE_PTY_HANDOFF']) {
    if (!current.includes(name)) current.push(name)
  }
  process.env.WSLENV = current.filter(Boolean).join(':')
}

/**
 * Drop-in replacement for `promisify(execFile)` so every existing call site
 * keeps its shape (`{ stdout, stderr }`) and only the launch changes.
 */
export interface ExecToolOptions {
  cwd?: string
  timeout?: number
  maxBuffer?: number
  windowsHide?: boolean
  encoding?: BufferEncoding
}

export function execTool(file: string, args: readonly string[], options: ExecToolOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return spawnSpec(file, [...args], { cwd: options.cwd }).then(
    (spec) =>
      new Promise((resolve, reject) => {
        execFile(
          spec.file,
          spec.args,
          {
            // The distro performs its own `cd`, so the Windows helper starts in
            // a directory it can always use.
            cwd: choice().kind === 'wsl' ? undefined : options.cwd,
            timeout: options.timeout,
            maxBuffer: options.maxBuffer,
            windowsHide: options.windowsHide ?? true,
            env: { ...process.env, ...spec.env }
          },
          (err, stdout, stderr) => {
            const out = typeof stdout === 'string' ? stdout : String(stdout ?? '')
            const errOut = typeof stderr === 'string' ? stderr : String(stderr ?? '')
            if (err) {
              // Keep Node's error shape but give the caller the tool's own words.
              const failure = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; message: string }
              failure.stdout = out
              failure.stderr = errOut
              if (errOut.trim() && !failure.message.includes(errOut.trim())) failure.message = `${failure.message}\n${errOut.trim()}`
              reject(failure)
              return
            }
            resolve({ stdout: out, stderr: errOut })
          }
        )
      })
  )
}

/* ---------------- probe ---------------- */

/** What Setup shows: distros on this machine and whether each tool answers. */
export async function probeToolchain(): Promise<ToolchainProbe> {
  const current = choice()
  const distros = await listDistros()
  const tools: ToolchainProbe['tools'] = []
  for (const name of ['gh', 'opencode', 'git'] as const) {
    tools.push(await probeTool(name))
  }
  return {
    choice: current,
    label: labelFor(current),
    distros,
    translated: current.kind === 'wsl',
    tools
  }
}

async function probeTool(name: 'gh' | 'opencode' | 'git'): Promise<ToolchainProbe['tools'][number]> {
  const c = choice()
  try {
    if (c.kind === 'native') {
      // On Windows `where.exe` finds `.exe`, `.cmd` and `.bat` shims alike.
      const res = isWindows
        ? await runNative('where.exe', [name])
        : await runNative('sh', ['-c', `command -v ${name}`])
      const first = res.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]
      return first
        ? { name, ok: true, detail: first }
        : { name, ok: false, detail: 'not on the system PATH' }
    }
    const spec = await spawnSpec(name, ['--version'])
    const res = await runSpec(spec)
    const first = res.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]
    return res.ok && first
      ? { name, ok: true, detail: first }
      : { name, ok: false, detail: (res.err || 'not found in this environment').split(/\r?\n/)[0] ?? 'not found' }
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message.split('\n')[0] ?? 'check failed' }
  }
}

function runNative(file: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        err: (typeof stderr === 'string' ? stderr : String(stderr ?? '')) || (err ? err.message : '')
      })
    })
  })
}

function runSpec(spec: SpawnSpec): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(spec.file, spec.args, { timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        err: (typeof stderr === 'string' ? stderr : String(stderr ?? '')) || (err ? err.message : '')
      })
    })
  })
}

/* ---------------- helpers used by the service ---------------- */

/**
 * Registration file the service writes and Revva reads. A WSL service keeps its
 * state inside the distro unless it is pointed at a folder Windows can also see,
 * so the state directory is pinned under Revva's own userData. Creating it here
 * keeps the folder owned by Windows instead of by the distro's default umask.
 */
export function serviceStateFile(userDataDir: string): { file?: string; env: Record<string, string> } {
  const c = choice()
  if (c.kind !== 'wsl') return { env: {} }
  const stateDir = join(userDataDir, 'opencode-state')
  mkdirSync(join(stateDir, 'opencode'), { recursive: true })
  return {
    file: join(stateDir, 'opencode', 'service.json'),
    env: { XDG_STATE_HOME: stateDir }
  }
}

/** The WSL form of Revva's state directory, for the spawn script. */
export async function serviceStateEnv(userDataDir: string): Promise<Record<string, string>> {
  const c = choice()
  if (c.kind !== 'wsl') return {}
  await primePaths()
  return { XDG_STATE_HOME: toToolPath(join(userDataDir, 'opencode-state')) }
}

/** Whether `opencode` is reachable in the chosen environment. */
export async function openCodeAvailable(): Promise<{ ok: boolean; detail: string }> {
  const c = choice()
  if (c.kind === 'native') return { ok: true, detail: '' }
  const found = await resolveTool('opencode')
  if (found) return { ok: true, detail: found }
  return {
    ok: false,
    detail: c.kind === 'wsl'
      ? `\`opencode\` was not found in ${c.distro || 'the default WSL distribution'}. Install it there or choose another command environment in Setup.`
      : 'The custom command environment could not run `opencode`.'
  }
}

