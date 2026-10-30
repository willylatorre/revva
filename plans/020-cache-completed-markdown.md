# Plan 020: Reuse bounded completed Markdown parse results

## Status
- Priority: P2; effort: M; risk: MED; category: perf
- Depends on: 017, 018, 019 (serial rollout; build on 018 Markdown component)
- Planned at: `298d1df`, 2026-10-30

## Why this matters
TanStack caches message data, but ReactMarkdown reparses after component unmount/conversation switching. A renderer-local bounded cache can reuse completed representations and settled blocks without accumulating every streaming prefix.

## Current state and conventions
`src/renderer/src/views/Chat.tsx` currently uses memoized ReactMarkdown/remarkGfm. Memo only survives the mounted component. Post-018 `assistant-markdown.tsx`/streaming-markdown.ts own stable blocks. `src/renderer/src/components/message-markdown.tsx` owns external-link handlers, GFM styling and disabled checkboxes. Preserve these and React rendering; do not enable unsafe raw HTML. React 19, ESM, TypeScript, single quotes/no semicolons. `package.json` lists react-markdown and remark-gfm, not a direct unified/remark-parse dependency.

## Scope
Allowed: `src/renderer/src/components/assistant-markdown.tsx`, `src/renderer/src/lib/{markdown-cache,streaming-markdown}.ts`, `src/renderer/src/components/transcript-content.tsx` or Chat.tsx only for the Markdown call site, `CHANGELOG.md`; `package.json` and `pnpm-lock.yaml` only if existing parser dependencies must be declared directly for an AST implementation, with evidence and minimal additions.
Out of scope: main/preload/shared, persistent caches, HTML sinks, visuals, provider/model settings, version bump, test infrastructure, application-wide Query policy.

## Workflow / commands
Use the isolated worktree after dependencies. `git diff --stat 298d1df..HEAD -- src/renderer/src/components src/renderer/src/lib src/renderer/src/views/Chat.tsx` → review expected 017–019 changes before editing. Use installed public exports, not undocumented transitive imports. Reviewer maintains index. Commit scoped work; never push or merge.

## Steps
1. Inspect ReactMarkdown public APIs and choose the smallest safe reusable parse/render representation. Prefer existing dependencies and React elements/AST with stable module-level components; do not retain DOM nodes or component instances. If direct parser imports are necessary, declare their existing versions directly rather than relying on pnpm hoisting. Verify: `pnpm typecheck` baseline and documented representation choice.
   Evidence: installed `node_modules/react-markdown/lib/index.js:175–178` creates a processor, parses, runs transformations and returns a compiled React element. Caching merely `<ReactMarkdown>{text}</ReactMarkdown>` caches an unevaluated component description and does NOT avoid parsing after remount; this is not an acceptable implementation. Preserve the existing library's public security/rendering behavior; do not depend on its private createProcessor/post functions or assume arbitrary React components may safely be called as factories. A public unified parser plugin caching its parser result is a possible safe AST approach, with mutation protection and directly declared dependencies if imported.
2. Add renderer-memory cache keyed by source plus parser/options version. Limit estimated bytes (initial budget 8 MiB) and entry count (e.g. 256); oversize entries bypass caching. Include source and representation overhead in accounting; label it estimated, not actual RSS. Real LRU hits update recency. Cache only final documents/settled blocks, never mutable prefixes. Verify: `pnpm typecheck`.
   For a unified parser-plugin approach, wrap the installed remark-parse parser through the public plugin protocol only after it is registered, while preserving the processor's final GFM extensions. Cache the parse-stage tree separately from later transforms: transformations must not mutate the cached entry. A defensive structured clone on store/read is acceptable; measure the trade-off honestly. Use a typed parser/config version rather than reusing ASTs across arbitrary plugin configurations. Expose cache eligibility explicitly: settled block/final document yes, mutable streaming tail no. Do not cache every tail through a common RenderedAssistantMarkdown wrapper by accident.
3. Integrate in completed/block rendering without stale message/session handlers. Ensure source edits or parser configuration changes miss cache. Preserve sanitized/safe URLs and MD_COMPONENTS. Add factual Unreleased bullet. Verify: `pnpm typecheck`, `pnpm build`, `git diff --check`; lockfile unchanged unless specifically justified direct imports.

## Manual verification / evidence
No test framework, unit/E2E fixtures or production test seams. Switch repeatedly between large existing conversations; profile warm versus cold parsing and allocations. Check code blocks/tables/lists/task boxes/link clicks, changed text, eviction and oversized bypass in a disposable preview. Cache remains ephemeral and bounded; report any checks not performed.

## Done criteria
- Cache reused across unmounts, genuine bounded LRU, immutable source/options key, no intermediate-prefix history.
- React presentation/safe-link semantics preserved; no raw HTML sink.
- Gate results and scoped diff recorded, factual changelog; dependency change only if justified.

## STOP / maintenance
Stop if safe caching requires private ReactMarkdown internals or broad parser replacement, or after two failed gate repairs. On future parser/component option changes, bump cache version/identity. Do not persist transcripts to disk as part of this cache.
