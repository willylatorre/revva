# Plan 020: Reuse bounded completed Markdown parse results

## Status
- Priority: P2; effort: M; risk: MED; category: perf
- Depends on: 017, 018 (both merged); 019 is independent and may execute in parallel in a separate worktree
- Planned at: `d7af098`, 2026-10-30; refreshed for the owner's explicit parallel-execution request

## Why this matters
TanStack caches message data, but ReactMarkdown reparses after component unmount/conversation switching. A renderer-local bounded cache can reuse completed representations and settled blocks without accumulating every streaming prefix.

## Current state and conventions
`src/renderer/src/views/Chat.tsx` currently uses memoized ReactMarkdown/remarkGfm. Memo only survives the mounted component. Post-018 `assistant-markdown.tsx`/streaming-markdown.ts own stable blocks. `src/renderer/src/components/message-markdown.tsx` owns external-link handlers, GFM styling and disabled checkboxes. Preserve these and React rendering; do not enable unsafe raw HTML. React 19, ESM, TypeScript, single quotes/no semicolons. `package.json` lists react-markdown and remark-gfm, not a direct unified/remark-parse dependency.

## Scope
Allowed: `src/renderer/src/components/assistant-markdown.tsx`, `src/renderer/src/lib/{markdown-cache,streaming-markdown}.ts`, `src/renderer/src/components/transcript-content.tsx` or Chat.tsx only for the Markdown call site, `CHANGELOG.md`; `package.json` and `pnpm-lock.yaml` only if existing parser dependencies must be declared directly for an AST implementation, with evidence and minimal additions.
Out of scope: main/preload/shared, persistent caches, HTML sinks, visuals, provider/model settings, version bump, test infrastructure, application-wide Query policy.

## Workflow / commands
Use `/Users/a2023362/.local/share/opencode/worktree/9d8a46/completed-markdown-cache`, isolated at d7af098 after 017/018. `git diff --stat d7af098..HEAD -- src/renderer/src/components src/renderer/src/lib src/renderer/src/views/Chat.tsx` → no unexpected drift. Use installed public exports, not undocumented transitive imports. Reviewer maintains index. Commit scoped work; never push or merge. Plan 019 runs elsewhere; do not touch its main/shared/transcript-stream files. Separate changelog additions will be integrated after review, not by overlapping writers.

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

## Execution / review record — 2026-10-30
Implemented in `88304c3`, revised after advisor review at `3ab6572` on `perf/completed-markdown-cache`. A public unified parser wrapper caches immutable mdast trees for exact source/config identity. Final documents and settled blocks opt in; mutable tails and whole-document streaming fallbacks remain uncached. Entries are limited to 256 and 8 MiB estimated source/AST bytes, with real LRU, oversize bypass and defensive cloning. A single exact-version `unified` devDependency declares the existing graph's type-only imports; no runtime parser replacement or new test tooling.

Review rejected the original disposable probe as evidence because it copied the cache implementation and used different hashing/UTF-8 accounting than production. It also required accounting for positions, identifiers, labels and general AST object fields, not just selected text fields. Revision uses an iterative, capped structural estimate and real-source probes at the existing public parser/plugin/component boundaries. The old mirror timings are withdrawn.

Advisor read the full diff and independently reran `pnpm typecheck`, `pnpm build`, `git diff --check d7af098..HEAD` (all exit 0). Reran the actual-source disposable probes: tier 1 has 20 passing checks (not the executor's reported 21), tier 2 has 16. Cold/hit output matches the plain pipeline through real MD_COMPONENTS; hits skip fresh parses; edits miss; mutation isolation, true LRU, estimated-byte eviction and oversize bypass behave correctly; mutable tail/full streamed prefixes remain uncached. Scratch Node parse-only sample: fresh ~51.27 ms/call versus clone-on-hit ~10.46 ms/call, excluding transformations/render/browser layout. This is not an app-level latency claim. APPROVE code/gates; GUI switching/typing/profiling remains outstanding.

Owner-requested integration merged the cache locally in `db6dabe` and the research-only 021 report in `6dd7e76`. Isolated combined typecheck/build/diff checks passed; dependencies were synchronized with the frozen lockfile. Existing source/plan/font UI edits were preserved and remain unstaged; a second backup stash was retained. The two original title/wordmark release-note paragraphs that an unrelated concurrent merge had dropped were restored byte-for-byte from the first backup stash, without changing committed source or dropping any new release notes. No push. Full performance-only review is pinned to 298d1df...6dd7e76.
