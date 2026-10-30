# Plan 019: Suppress only proven-redundant tool history refreshes

## Status
- Priority: P1; effort: M; risk: MED; category: perf
- Depends on: 017, 018 (execute serially to simplify review; no rendering dependency in the mechanism)
- Planned at: `298d1df`, 2026-10-30

## Why this matters
Tool state already travels through transcript batches, but chat.tool notifications also trigger history fetches. Reduce duplicate work only when complete event coverage is known. Existing plan 016 documents incomplete native draft snapshots: its ten-second heartbeat and session.step.streamed recovery hints are intentionally retained.

## Current state and conventions
- `src/main/opencode/bus.ts:64–80`: calls streamBuffer.onEvent first; session.step.streamed emits session.transcript/reset:false; TOOL_STATE_EVENTS emits chat.tool.
- `src/main/opencode/stream-buffer.ts:279–296`: tool started/called/success/failed sends tool summaries; lifecycle updates flush immediately, including when coverage may be incomplete.
- `src/renderer/src/lib/transcript-stream.ts:266–277`: applies transcript.batch with epoch/sequence validation; incomplete state resets, loading queues bounded pending batches.
  ```ts
  } else if (event.kind === 'session.transcript') {
    if (event.reset === false) refresh(event.sessionId)
    else reset(event.sessionId)
  } else if (event.kind === 'chat.tool') {
    refresh(event.sessionId)
  }
  ```
- `Chat.tsx` history still polls running visible transcripts at ten seconds and preserves completion recovery. `chats.ts` uses oldest unresolved-tool overlap to avoid losing earlier steps.
- Single ESM event consumer; shared typed IPC, zod-free preload, numeric/content-free diagnostics only. No change to agent execution.

## Scope
Allowed: `src/renderer/src/lib/transcript-stream.ts`, `src/main/opencode/{bus,stream-buffer,performance}.ts`, `src/shared/types.ts` only for backward-compatible optional matching identifiers/coverage metadata on chat.tool or a tool update, `CHANGELOG.md`.
Do not edit chats.ts pagination/anchors, Chat heartbeat, step-streamed hints, completion/reset/reconnect signals, subscription epochs, review/verdict/shipping, model/provider/prompt configuration, dependencies or version.

## Workflow / commands
Work in the provided isolated worktree. `git diff --stat 298d1df..HEAD -- src/main/opencode/bus.ts src/main/opencode/stream-buffer.ts src/renderer/src/lib/transcript-stream.ts` → no unexpected mechanism drift. Existing dirty original shared/types.ts changes are unrelated and must not be copied/reverted. Commit scoped work there only; reviewer maintains index.

## Steps
1. Trace actual installed event schemas and all chat.tool consumers. Determine an explicit reliable coverage condition: valid attached epoch, known complete message/tool mapping, no snapshot/loading/gap/awaiting-prefix state, and applied matching lifecycle update. If this cannot be established cheaply, STOP and retain current behavior. Verify: document contract evidence and `pnpm typecheck` baseline.
   Current evidence: streamBuffer reads native `data.assistantMessageID` and `data.id`; bus currently discards both when pushing chat.tool (only sessionId/tool name/state survive). A name is not an identity. If needed, add optional `messageId` and `toolId` to chat.tool and populate only when actual native fields are strings, so renderer matches the corresponding batch's `messageId`/`partId` and terminal/running state. Absent IDs retain fallback. Track receipt/application per epoch, not just an already cached terminal tool. Snapshot loading, unknown prefixes or dropped/regressive updates are not proof of matching application.
2. Suppress renderer history invalidation only for matching lifecycle hints already represented by a valid applied batch. Track coverage with bounded state cleared on reset/release/gap/reconnect; do not introduce one timer per tool or infer completeness solely from 'some batch recently arrived'. Preserve refresh for unknown tool/message/prefix and ordering races. Prefer renderer-local state over widening the protocol. Verify: `pnpm typecheck`.
   Record an exact lifecycle receipt (running for called, completed for success, error for failed), NOT a rank where completed/error are interchangeable. Consume the receipt when matching chat.tool arrives; stale cached tool state cannot suppress a hint with no new covering batch. Record only actual accepted application, not updates skipped by olderTool. The native cursor may silently become unknown after part-budget overflow before renderer awaiting is refreshed (`stream-buffer.ts:221,268–274`); if renderer alone cannot prove prefix completeness, carry a small optional main-side coverage flag and keep fallback when it is false/absent rather than weakening this condition. Existing per-channel flush-before-hint order makes these receipts short-lived and bounded.
3. Keep step-streamed hints and ten-second heartbeat unchanged; keep completion authoritative fetches. Add opt-in numeric suppressed/fallback counts if useful under existing meter, never content/session logging. Add factual Unreleased note. Verify: `pnpm typecheck`, `pnpm build`, `git diff --check`.

## Manual verification (no automated tests)
With existing running conversations where possible, observe tool input/called/completed/failed states and output. Compare history request counts in REVVA_DEBUG_PERF; use the same representative workload for before/after claims. Rapid switching, unknown-prefix attach, gaps, reconnect, completion and interruption must still request recovery when needed. Preserve background permission/status/review behavior. If not exercised, report outstanding rather than removing safety nets.

## Done criteria
- Scoped gates pass against baseline.
- Suppression has explicit matching lifecycle coverage, bounded bookkeeping and reset cleanup.
- Unknown coverage retains refresh; heartbeat/step-streamed/final/reset recovery remain.
- Changelog and honest verification record, no tests/dependencies/configuration changes.

## STOP / maintenance
Stop if matching coverage cannot be proven, if schema differs, if broad protocol work is required, or if gate repair fails twice. Plan 016 remains BLOCKED on its existing matrix and must not be marked DONE here. New tool fields/event variants may require widening coverage or keeping fallback.

## Execution / review record — 2026-10-30
Implemented in `8f57b2c`, revised after review in `56422aa` on `perf/pandacode-streaming-performance`. Main returns lifecycle coverage only for a known cursor and a retained synchronous batch; optional message/tool IDs carry this proof on the subsequent hint. Renderer records exact accepted live applications with bounded, collision-free ID tuples; missing coverage retains the history refresh. Snapshot loading/replay/awaiting prefixes, gaps, resets, release and conflicting authoritative terminal tool state invalidate suppression. Receipts are consumed even when the hint falls back.

Review identified a snapshot-begin race: the first version lacked hint-time loading/force-reset/awaiting checks and could retain coverage across snapshot replacement. Revision clears receipts at snapshot begin, checks the current surface at hint time and clears unknown-ID hints conservatively. Heartbeat, step-streamed hints, final recovery, pagination and epoch contracts remain unchanged.

Advisor read both commits and independently reran `pnpm typecheck`, `pnpm build`, `git diff --check fcc5f07..HEAD` after revision (all exit 0). APPROVE code/gates; identical live tool-workload counters, reconnect/gap/snapshot-during-tool GUI checks remain outstanding. No measured request reduction claimed. Executor reported an external worktree removal during initial editing; only its own worktree was restored from surviving fcc5f07 and code re-authored before committing. No original/user source changes were copied, overwritten, merged or pushed.

Owner subsequently requested merge and explicitly authorized preserving/stashing/restoring local edits. Integration executor prepared and verified the merge in isolation, then fast-forwarded local main to `6174c4e` (parents d7af098 and 56422aa). Advisor verified ancestry, five-file scope and diff checks. Existing source/plan edits were restored; only add-only changelog insertions used a temporary union driver, preserving all bullets. Backup stash `648b753c77d2c3549f661133549a5b0f3ec8bb3e` and the external backup directory remain for recovery. No push; the full combined review waits for 020 and integration of the 021 no-replacement conclusion.
