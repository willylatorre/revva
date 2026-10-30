# Plan 022: Preserve code fences after blockquote lazy continuation

## Status
- Priority: P1; effort: S; risk: LOW; category: bug
- Depends on: completed 018 and combined performance review
- Planned at: `36f7c80`, 2026-10-30
- Owner authorization: fix the remaining review blocker, then commit and merge when ready; no push requested in this follow-up.

## Why this matters / current state
The combined Spec review found one medium-severity streaming-only rendering bug. In `src/renderer/src/lib/streaming-markdown.ts:117–133`, the inQuote branch falls back for `QUOTE_FENCE` but treats an unprefixed fence as lazy paragraph continuation:
```ts
if (inQuote) {
  if (QUOTE_FENCE.test(line)) return null
  // ... blank-line settling ...
  i += 1 // lazy paragraph continuation keeps the quote open
}
```
The list branch already checks `FENCE_INSIDE` for this ambiguity. The source `> quote\nlazy\n\u0060\u0060\u0060\n\ncode?` incorrectly settles a block ending with an open fence and renders code? as a paragraph. The whole installed CommonMark/GFM parser instead keeps it in the code block. Final completion repairs it, but streaming presentation is wrong. The coordinator independently reproduced the AST mismatch using the actual baseline splitter and installed parser.

## Scope / conventions
Only modify `src/renderer/src/lib/streaming-markdown.ts` and add one factual Unreleased bullet in `CHANGELOG.md`. No other source, parser/cache changes, dependencies, version bump, model/provider settings or tests/tooling. Match single quotes/no semicolons and the existing conservative whole-document fallback. Do not redesign list/quote parsing.

## Workflow / commands
Use isolated `/Users/a2023362/.local/share/opencode/worktree/9d8a46/fix-streaming-quote-fence`, initially at 36f7c80. Create a nonconflicting fix branch and commit only scoped changes. No original checkout edits, merge, push, stash, reset or worktree removals. Reviewer owns plan/report updates. Drift check: `git diff --stat 36f7c80..HEAD -- src/renderer/src/lib/streaming-markdown.ts CHANGELOG.md` → no unexpected changes. If dependencies absent, `pnpm install --frozen-lockfile` in this worktree only (no symlink to other node_modules).

## Steps
1. Reproduce the exact mismatch before editing using a disposable external script importing the real splitter and installed remark parser; retain only numeric/synthetic-case outputs. Confirm the whole code block and split paragraph differ. Verify baseline `pnpm typecheck` → exit 0.
2. Extend the inQuote fallback to include `FENCE_INSIDE.test(line)` alongside the existing quote-prefixed guard. This intentionally falls back instead of guessing container/fence ownership. Add a short explanation if needed; no unrelated cleanup. Verify the repro now takes fallback and therefore matches the whole parser.
3. Check backtick/tilde fences, quote-prefixed fences, lazy continuation with/without a preceding list-like line, closed/unclosed fences, ordinary quote closure and top-level fences. Use actual-source disposable AST/render comparisons only, not copied splitter logic or persistent tests. Verify `pnpm typecheck`, `pnpm build`, `git diff --check` → exit 0. Add Unreleased note about faithful streaming code presentation, not a speed claim.

## Done / STOP
Done: precise repro no longer splits an open fence, ordinary cases retain their behavior, scoped gates pass, commit SHA and honest GUI limitations reported. STOP for source drift, necessary out-of-scope changes or twice-failing gates. No new automated test framework/fixtures or production test seams; no billed model/service calls. The existing raw-HTML/reference fallbacks, pacing, completion and cache eligibility remain unchanged.

## Execution / review record — 2026-10-30
Executor implemented `c32016e` (parent `36f7c80`) on `fix/streaming-quote-fence` in the isolated worktree: one-line guard extension `QUOTE_FENCE.test(line) || FENCE_INSIDE.test(line)` plus comment, and one factual Unreleased bullet. Disposable probes under the approved temp dir used the actual worktree splitter and installed parser: the repro now falls back (matching the whole parser), 15 named cases all match or fall back, and a 2,496-source baseline-vs-fixed differential showed zero changed non-null splits, zero loosened splits, 503 added fallbacks. The 8 still-unsafe corpus shapes are byte-identical between baseline and fixed — pre-existing conservative-scan misses, not introduced here; advisor reran the residual probe to confirm. Advisor independently reran `pnpm typecheck`, `pnpm build`, `git diff --check` (exit 0). Merged into local main by fast-forward; the CHANGELOG add-only stash-apply conflict was resolved keeping both sides. GUI streaming check outstanding. No push.
