#!/usr/bin/env node
/**
 * Release helper: bumps the version, seals the [Unreleased] changelog section,
 * commits + tags, and pushes — the tag then triggers .github/workflows/release.yml
 * which builds the mac dmg/zip and publishes a GitHub Release for downloads.
 *
 * Usage: pnpm release:patch | release:minor | release:major
 * Dry run (no writes/push):  node scripts/release.mjs patch --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const pkgPath = new URL('../package.json', import.meta.url)
const changelogPath = new URL('../CHANGELOG.md', import.meta.url)

const bump = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!['patch', 'minor', 'major'].includes(bump ?? '')) {
  console.error('usage: node scripts/release.mjs <patch|minor|major> [--dry-run]')
  process.exit(1)
}

const sh = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts })
  if (res.status !== 0) {
    console.error(`$ ${cmd} ${args.join(' ')}\n${res.stderr ?? res.stdout}`)
    process.exit(1)
  }
  return res.stdout.trim()
}

function fail(msg) {
  console.error(`release aborted: ${msg}`)
  process.exit(1)
}

/* ---- preflight ---- */
const branch = sh('git', ['branch', '--show-current'])
if (branch !== 'main') fail(`release from main, not "${branch}"`)
if (sh('git', ['status', '--porcelain'])) fail('working tree must be clean — commit first')
sh('git', ['fetch', '--quiet', 'origin'])
if (sh('git', ['rev-list', 'HEAD..origin/main'])) fail('local main is behind origin — pull first')

/* ---- compute version ---- */
const pkgSource = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(pkgSource)
const [maj, min, pat] = pkg.version.split('.').map(Number)
const next =
  bump === 'major' ? [maj + 1, 0, 0]
    : bump === 'minor' ? [maj, min + 1, 0]
      : [maj, min, pat + 1]
const version = next.join('.')
const tag = `v${version}`
if (sh('git', ['tag', '-l', tag])) fail(`${tag} already exists`)

console.log(`revva ${pkg.version} → ${version} (${bump})${dryRun ? ' [dry-run]' : ''}`)

/* ---- changelog: seal [Unreleased] under the new version ---- */
// A checkout with core.autocrlf=true hands us CRLF; sealing is done in LF and
// written back in the file's own line endings so the diff stays line-ending-free.
const changelogRaw = readFileSync(changelogPath, 'utf8')
const eol = changelogRaw.includes('\r\n') ? '\r\n' : '\n'
const changelog = changelogRaw.replace(/\r\n/g, '\n')
if (!changelog.includes('## [Unreleased]')) fail('CHANGELOG.md must keep a "## [Unreleased]" heading')
const unreleasedBody = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## |\Z)/m)?.[1]?.trim() ?? ''
if (!unreleasedBody) fail('could not read the "## [Unreleased]" section')
const notes =
  !/^-\s*(none|n\/a|nothing yet)\.?$/i.test(unreleasedBody)
    ? unreleasedBody
    : '_No user-facing changes recorded._'
const today = new Date().toISOString().slice(0, 10)
const sealedChangelog = changelog.replace(
  /^## \[Unreleased\]\n[\s\S]*?(?=^## |\Z)/m,
  `## [Unreleased]\n\n- (nothing yet)\n\n## [${version}] - ${today}\n\n${notes}\n\n`
).replace(/\n/g, eol)

if (dryRun) {
  console.log('--- CHANGELOG.md would gain: ---')
  const sealedLines = sealedChangelog.split(eol).join('\n')
  const idx = sealedLines.indexOf(`## [${version}]`)
  const end = sealedLines.indexOf('\n\n## ', idx)
  console.log(sealedLines.slice(idx, end === -1 ? undefined : end))
  process.exit(0)
}

/* ---- apply: package.json line-preserving bump, changelog, commit, tag, push ---- */
writeFileSync(pkgPath, pkgSource.replace(/"version": "[^"]+"/, `"version": "${version}"`))
writeFileSync(changelogPath, sealedChangelog)

sh('git', ['add', 'package.json', 'CHANGELOG.md'])
sh('git', ['commit', '-m', `chore(release): ${tag}`])
sh('git', ['tag', tag])
sh('git', ['push', 'origin', 'main', tag])

console.log(`\n${tag} pushed. GitHub Actions is now building the installer:`)
console.log('  https://github.com/willylatorre/revva/actions')
console.log(`Downloads will land on:\n  https://github.com/willylatorre/revva/releases/tag/${tag}`)
