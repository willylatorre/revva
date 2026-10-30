# Plan 021: Measure a faster Markdown parser before adopting it

## Status
- Priority: P3; effort: M–L; risk: HIGH for adoption; category: perf
- Depends on: 017–020
- Planned at: `298d1df`, 2026-10-30

## Why this matters
PandaCode uses md4c WebAssembly, but its benchmark mixes parser, incremental rendering and different state architectures. Revva should adopt a parser replacement only after comparing actual parse/conversion/render cost and compatibility, not from assumed WASM superiority.

## Current state and conventions
Revva uses react-markdown 10 / remark-gfm 4 and MD_COMPONENTS; 018–020 reduce repeated work and add bounded reusable representations. PandaCode inspected at 0336a2fb5e3abaea35c095fcc63805652f49ea98: `src/enriched-markdown.ts` loads md4c, caches compiled module and resets long-lived engines above a 64 MiB WASM memory cap. Its license adds attribution obligations; do not vendor PandaCode implementation. Use upstream/licensed artifacts only.

## Scope
Always allowed: `plans/021-markdown-parser-performance-spike.md` to append findings. Temporary exploratory scripts/artifacts belong only in approved external temporary directory, not production or test folders.
Conditionally allowed only after evidence supports adoption: focused renderer parser adapter under `src/renderer/src/lib`, assistant-markdown/cache integration, `package.json`/`pnpm-lock.yaml` for upstream parser dependency, `CHANGELOG.md`. No copied PandaCode code, native/Tauri migration, provider/model settings, HTML sinks, version bump, tests/frameworks or broader UI changes.

## Workflow / commands
Use provided isolated worktree after 017–020. Compare `git diff --stat 298d1df..HEAD -- package.json pnpm-lock.yaml src/renderer/src` with expected earlier changes. Use a separate temporary sandbox for candidate dependency installation, not user checkout. Commit only evidence-backed scoped code; no push/merge. Reviewer maintains index.

## Steps
1. Inspect available upstream md4c/WASM distributions for licensing, API, GFM support, bundle/startup costs and React/AST conversion. Record exact version/source and whether safe integration is feasible. Never invent package/API. If no maintainable compatible candidate exists, record BLOCKED/REJECTED reason and leave production parser unchanged. Verify: recorded package/docs evidence.
2. Build a disposable deterministic performance workload outside repo: long prose/tables/lists/code, streaming append schedule, references/Unicode and final completion. Compare current post-020 path and candidate with equivalent rendering/security/features. Include initialization, parse, conversion, React rendering where feasible, final presentation delay and WASM memory outside JS heap. No automated test framework, persisted fixture or billed model call. Record commands, environment, medians and limitations; parser-only numbers are not an end-to-end adoption justification. Verify: actual recorded measurements, no invented values.
3. Adopt only if a material end-to-end gain is demonstrated (target >=20% less renderer script work on representative long replies without meaningful cold-open/final-delay regression) and GFM/security equivalence is manually checked. Otherwise retain current parser and explain the decision in this plan. Missing browser profiling or equivalent rendering means defer adoption, not infer success from microbenchmark. Verify: evidence/table and explicit decision.
4. If adopting, use small typed adapter with bounded memory, stale-result rejection, current safe React rendering and current-parser fallback. Cache identity includes backend/options/version. Add factual Unreleased bullet only for adopted behavior. Verify: `pnpm typecheck`, `pnpm build`, `git diff --check`; manually verify GFM/security/cold-load failure.

## Done criteria
- Documented candidate/version/license and actual comparison, or concrete inability/blocker.
- No speculative production parser replacement.
- Any adoption is scoped, gates pass, fallback and memory bounds exist, compatibility checked.
- No repository test tooling/fixtures, PandaCode source copying, or performance claims unsupported by numbers.

## STOP / maintenance
Stop/defer if no maintained upstream candidate, equivalent render comparison unavailable, compatibility/security regresses, or the necessary change expands beyond scope. A rejected/deferred replacement is a successful spike outcome, not a demand to force a dependency into production.

## Preliminary upstream research (2026-10-30; not benchmark results)
- `md4x` is a maintained MIT candidate with a Comark AST API and a standalone/inlined WASM build. Upstream renderer docs explicitly state the dialect is fixed and no entry point takes parser flags: https://github.com/unjs/md4x/blob/main/docs/renderers.md. Frontmatter, component/attribute syntax and other extensions therefore need compatibility investigation; speed alone cannot justify silently changing ordinary assistant prose. Verify exact published version in the sandbox, not repository-main docs alone.
- `md4w@0.2.7` is MIT and offers configurable parsing/JSON AST, but its public history is older; investigate maintenance and asset-loading costs before considering adoption. Source: https://github.com/ije/md4w.
- `react-native-enriched-markdown@1.1.1` ships the parser PandaCode vendors, but its RN peers/native postinstall and undocumented internal web-parser file make installing the full package a poor fit. Do not copy PandaCode's wrapper or depend on RN internals.
- Revva's `src/renderer/index.html:9` currently uses `script-src 'self'`; production WASM compilation would require a separately reviewed `wasm-unsafe-eval` CSP addition. This is outside the current conditional adoption scope. A disposable external benchmark need not weaken production CSP; defer adoption if this scope decision is needed.
- Important correction to helper research: current ReactMarkdown does NOT omit raw HTML by default. Installed `node_modules/react-markdown/lib/index.js:359–365` converts raw nodes to literal text unless skipHtml is set. Preserve literal display, safe URLs and existing task-checkbox behavior; simply dropping candidate HTML nodes is not equivalent.
- No parser or end-to-end measurements have been run. These findings do not establish a speedup and do not authorize a production replacement.
