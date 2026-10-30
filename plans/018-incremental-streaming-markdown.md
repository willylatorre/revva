# Plan 018: Parse only the mutable Markdown tail

## Status
- Priority: P1; effort: L; risk: HIGH; category: perf
- Depends on: 017
- Planned at: `298d1df`, 2026-10-30. Changes from 017 are an expected dependency, not unrelated drift.

## Why this matters
Revva currently reparses the entire growing answer roughly seven times a second. Retain completed independent blocks and parse only the mutable tail without changing the existing GFM presentation or safe-link behavior.

## Current state and conventions
In `src/renderer/src/views/Chat.tsx:888–903` (before extraction by 017):
```tsx
const RenderedAssistantMarkdown = memo(function RenderedAssistantMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
})
// AssistantMarkdown observes latest text via ref, publishes it every 150 ms,
// and renders the current text immediately when streaming becomes false.
```
`src/renderer/src/components/message-markdown.tsx` owns assistant link handlers, table/list/code styling and disabled task checkboxes. Preserve these. React 19, TypeScript, existing shadcn primitives, single quotes/no semicolons; no generic new UI primitive. OpenCode execution and transport are out of scope.

## Scope
Allowed: assistant Markdown composition in `src/renderer/src/views/Chat.tsx` or `src/renderer/src/components/transcript-content.tsx` (depending on 017 extraction), new `src/renderer/src/components/assistant-markdown.tsx`, new `src/renderer/src/lib/streaming-markdown.ts`, `CHANGELOG.md`.
Out of scope: user-message Markdown/composer preview, visual styles, raw HTML enablement, main/preload/shared, dependencies, version, test files, provider/model settings, review/shipping.

## Workflow / commands
Use the same isolated worktree after 017. `git diff --stat 298d1df..HEAD -- src/renderer/src/views/Chat.tsx src/renderer/src/components` → only documented dependency drift. Install only frozen existing dependencies if needed. Commit scoped work there; no push or merge. Reviewer maintains index.

## Steps
1. Read post-017 Markdown location; record `pnpm typecheck` baseline. Implement an independently written conservative splitter (borrow architecture, not PandaCode source). Scan complete lines for stable top-level boundaries outside open fences, list continuations, blockquotes and other structures. A boundary requires enough lookahead to establish the previous block is closed. Do not settle text merely because a blank line arrived. Verify: `pnpm typecheck`.
2. Handle syntax with document-wide effects by retaining whole-document rendering: reference definitions/links, raw HTML blocks and ambiguous constructs. Late definitions, a non-append change, or a previously invalid boundary must invalidate settled blocks. Do not split arbitrary regex-delimited paragraphs without these safeguards. Cache state must be per answer and bounded by that answer, not global streaming prefixes. Verify: source review plus `pnpm typecheck`.
3. Render stable blocks with stable keys and memoized source props using the existing ReactMarkdown/remarkGfm/MD_COMPONENTS path; only the tail changes. Keep at most the current source/block representation, no history of every prefix. Preserve the existing 150 ms pacing initially; publish completion immediately and reconcile to the full completed document. Verify: `pnpm typecheck` and `pnpm build`.
4. Ensure scroll following reacts to actual Markdown layout growth, not only incoming query notifications, while preserving user's scroll-up choice. Add Unreleased bullet with no measured-speedup claim. Verify: `git diff --check`, `pnpm typecheck`, `pnpm build`.

## Manual verification / performance evidence
No unit/E2E files, fixtures, mocks, coverage or framework. In a disposable local preview, inspect gradually appended prose, closed/unclosed fences, tilde/backtick fences of differing lengths, tight/loose/nested lists, tables, task lists, blockquotes, setext headings, thematic breaks, inline code, partial links, late reference definitions, Unicode and non-append edits. Compare final output with the unsplit renderer. Profile a long reply and record parse/script work and final presentation delay; fallback cases may deliberately retain full parsing. No billed model call or user transcript mutation just to generate a workload without approval.

## Done criteria
- Stable independent prefixes are not reparsed on every streamed tail update.
- Completion uses immediate authoritative text; ambiguous/document-wide syntax stays correct through fallback.
- All three gates pass against baseline and changes stay scoped.
- Verification limitations are stated; no new persistent test harness or dependency.

## STOP / maintenance
If a correct useful splitter requires broad parser replacement, stop and report rather than weakening Markdown fidelity. Stop after two unsuccessful gate fixes or for out-of-scope edits. Future Markdown extensions can introduce cross-block semantics: update conservative fallback first. Do not claim incremental processing is O(delta) overall if boundary discovery still scans the document.

## Execution / review record — 2026-10-30
Implemented at `3a92388`, corrected after advisor review at `fcc5f07` on `perf/pandacode-streaming-performance`. New conservative splitter and assistant-markdown component retain flat React fragments, pace streaming at 150 ms and immediately render completed authoritative text. Transcript scrolling observes actual content resize while preserving manual scroll-up.

Review found missed quote/list-prefixed and multiline reference definitions, and a continuation whose list-marker width decreased. Disposable regression corpus showed 57 failures before the repair, zero afterward. The repair uses a coarse source-wide possible-definition fallback, minimum observed list content indent, and linear precomputed blank-line lookahead. Boundaries can shift as partial lookahead becomes complete; sources are recomputed rather than treated as irrevocably settled.

Advisor read both commits and independently ran `pnpm typecheck`, `pnpm build`, `git diff --check 298d1df..HEAD` (all exit 0). Also reran external disposable probes: 4,280 non-fallback AST prefix comparisons, 195 fallbacks, zero failures; 319 static-render comparisons including 181 split renders, zero mismatches. Render probe normalizes whitespace between tags, so it is not a byte-perfect physical-layout check. No persistent tests/dependencies/tooling added. APPROVE code/gates; manual GUI/profiler/latency evidence remains outstanding, no speedup claim or merge/push.
