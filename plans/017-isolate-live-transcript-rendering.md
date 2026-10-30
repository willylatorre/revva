# Plan 017: Isolate live transcript rendering

## Status
- Priority: P1; effort: M; risk: MED; category: perf
- Depends on: none (existing plan 016 machinery is already implemented; its outstanding manual checks remain outstanding)
- Planned at: `298d1df`, 2026-10-30. Source excerpts describe the current working copy; unrelated uncommitted collaboration changes are not part of this plan.

## Why this matters
Every live batch currently rerenders TranscriptView, regrouping historical assistant steps and revisiting the composer. Preserve React/Electron and existing visible-only subscriptions, but narrow high-frequency observation and give unchanged groups stable identities.

## Current state and conventions
- `src/renderer/src/views/Chat.tsx`: TranscriptView owns history, attachment, composer, live query, grouping and all cards.
  ```tsx
  const live = useQuery<LiveTranscript>({ queryKey: streamKey(sessionId), queryFn: () => EMPTY_STREAM,
    initialData: EMPTY_STREAM, structuralSharing: false, enabled: false })
  const rows = useMemo(() => mergeTranscript(messages.data ?? [], live.data ?? EMPTY_STREAM), [messages.data, live.data])
  const groups = useMemo(() => groupRows(rows), [rows])
  ```
- `groupRows` creates a new msgs array for every assistant turn; `AssistantTurn` is not memoized; `MessageRow` is memoized.
- `src/renderer/src/lib/transcript-stream.ts:39–75` preserves unchanged message identity. Build on it rather than replacing the epoch/sequence/reset/attachment protocols.
- Current scroll-follow effect depends on `messages.data, live.data, running`. Preserve stick-to-bottom and initial-session anchoring when moving it.
- Frontend is React 19 / TanStack Query / existing shadcn components, function components and typed props, single quotes, no semicolons. Reuse MD_COMPONENTS and the installed Collapsible/ScrollArea primitives; no visual redesign.
- Main is ESM, preload dependency-light. OpenCode owns execution. No model/provider configuration changes.

## Scope
Allowed: `src/renderer/src/views/Chat.tsx`, new focused `src/renderer/src/components/transcript-content.tsx` and/or `src/renderer/src/lib/transcript-groups.ts`, `CHANGELOG.md`.
Do not modify other screens, main/preload/shared IPC contracts, collaboration UI, dependencies, package version, prompts, review/shipping behavior, or plan 016 status.

## Workflow / commands
Use the isolated worktree provided by the coordinator, based on 298d1df, not the dirty original checkout. Run `git diff --stat 298d1df..HEAD -- src/renderer/src/views/Chat.tsx src/renderer/src/lib/transcript-stream.ts` and compare these excerpts before editing. If dependencies are absent, use `pnpm install --frozen-lockfile`; never alter the lockfile. Commit only your scoped work in this worktree; no push, merge, reset or stash. Reviewer maintains plans/README.md.

| Command | Expected |
| --- | --- |
| `pnpm typecheck` | Exit 0, or explicitly unchanged baseline failures |
| `pnpm build` | Exit 0 |
| `git diff --check` | Exit 0 |
| `REVVA_DEBUG_PERF=1 pnpm dev` | Manual app launch; no agent prompt is needed for existing-chat checks |

## Steps
1. Run and record baseline typecheck/build. Inspect TranscriptView live-data consumers and all callers (reviewer/fixer surfaces use the same component). Verify: baseline command results recorded.
2. Extract a narrow transcript content domain component and move the full live query there. Keep attachment/history/cancellation ownership unchanged. Provide a separate cheap derived activity observer whose primitive result changes only for status/step/tool/reasoning mode, not every appended answer character. Avoid a second subscription or duplicating HTTP loaders. Preserve references/props needed by scrolling. Verify: `pnpm typecheck` passes against baseline.
3. Stabilize groups using message identity and keyed group membership, bounded to the current transcript. Memoize AssistantTurn and ensure unchanged tools/earlier Markdown pieces in an active turn do not get expensive new props. Do not rely on memo alone while recreating arrays. Verify: `pnpm typecheck`; inspect that the composer no longer observes full session-stream data.
4. Preserve initial bottom anchoring, manual scroll-up behavior, immediate completion, empty/loading/error states and read-only transcripts. Add factual Unreleased bullet. Verify: `pnpm typecheck`, `pnpm build`, `git diff --check`.

## Manual verification (no automated tests)
Use existing conversations where possible: switch chats, scroll up while text grows, expand historical tool details, type in composer, open/close reviewer output. React profiler should show unchanged historical assistant cards skipping renders; composer should not rerender per text batch. Do not claim manual checks performed if no GUI capability is available.

## Done criteria
- Typecheck/build/diff checks recorded; no new baseline failures.
- Only scoped files changed, no dependencies or test infrastructure.
- Full live-data observation is confined to transcript/activity components; unchanged groups retain their arrays.
- Manual checks and profiler results recorded or explicitly outstanding; no invented speedup.

## STOP / maintenance
Stop for divergent stream contracts, necessary out-of-scope changes, or two failed gate-fix attempts. Do not copy or overwrite dirty original files. The original checkout has collaboration changes in Chat.tsx; eventual integration must preserve those separately. New ChatMessage fields/group membership must participate in group stability. Preserve attach/reset correctness, not merely render counts.

## Execution / review record — 2026-10-30
Implemented in isolated branch `perf/pandacode-streaming-performance`: `9ad43ac` plus review revision `d2384db`. Changes are exactly Chat.tsx, new transcript-content.tsx, new transcript-groups.ts and one Unreleased bullet. Full live observation moved into memoized TranscriptContent; finished turn arrays retain identity; activity uses a primitive external-store channel. Revision adds scalar equality for tools whose merged object identity changes, avoids null activity notifications on each value change, and publishes group stability baselines after commit rather than during render.

Advisor read the full diff and independently reran `pnpm typecheck`, `pnpm build`, `git diff --check 298d1df..HEAD`: all exit 0 after revision. APPROVE code/gates. Original source changes were not copied or overwritten. Manual app checks and React profiler confirmation remain outstanding; no latency improvement measured, no merge/push performed.
