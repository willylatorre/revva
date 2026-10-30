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

## Verified research, phase 1 (2026-10-30; isolated sandbox; worktree baseline `d7af098`)

Sandbox: `/private/var/folders/j2/p584kcbs4ndgj5lp016rmnpw0000gn/T/opencode/markdown-parser-spike/sandbox` (disposable npm install with `--ignore-scripts`; project manifest/lockfile untouched). Drift check `git diff --stat d7af098..HEAD -- package.json pnpm-lock.yaml src/renderer/src` → empty. Environment: node v24.16.0, darwin arm64, Apple M4 Pro; sandbox pins react-markdown 10.1.0, remark-gfm 4.0.1, react/react-dom 19.3.1 — exact `pnpm-lock.yaml` resolution. All probes synthetic-corpus only; no user content, no model calls, no persistent tests/fixtures.

### Candidate verification (registry + installed artifacts)
- `md4x@0.0.30` — MIT, published 2026-09-13, active release cadence through Sep 2026. Exports `./standalone` (WASM inlined in `lib/standalone.mjs`, 130,860 B raw / 105,047 B gzip), `./wasm`, `./napi`; no postinstall in the published artifact. API verified from shipped `lib/wasm/index.d.mts`: `init(opts?)`, `parseAST(input, opts?): ComarkTree` where `opts` is only `{heal?}` — **no parser flag exists**; `html` nodes carry raw source as text (matches react-markdown’s literal-HTML default if the adapter renders them as text). Uses `WebAssembly.compile/instantiate` with a `node:zlib`/`DecompressionStream` inflate branch.
- `md4w@0.2.7` — MIT, last published 2025-05-28 (stale). Configurable `ParseFlags`, `mdToJSON` numeric-node AST, init loads `md4w-fast.wasm` (883 KB) or `md4w-small.wasm` (60 KB). **Hard correctness bug found by probe:** `mdToJSON` emits invalid JSON for link titles — minimal repro `[a](/u "ttl")` throws `SyntaxError ... "title":tl` (unquoted string in emitted JSON); repro file also throws on `[r][x]\n\n[x]: /y "rt"`. `img` titles are fine. Disqualifies md4w `mdToJSON` for AST use despite parse speed (50,000-char ASCII no-title doc: median 1.60–1.70 ms, two runs).
- `react-native-enriched-markdown@1.1.1` — manifest confirms `postinstall: node postinstall.mjs` and peer `react-native`; not installed, consistent with prior finding — poor fit.

### Compatibility probe (library-level: default react-markdown components, `renderToStaticMarkup`)
Harness `sandbox/probe-compat.mjs` + `cases.mjs` + allowlist `adapter.mjs` (never spreads Comark props onto DOM; per-tag prop allowlist; unknown tags rendered transparently and reported). **Scope limit:** the baseline renders with react-markdown’s **default** elements, not Revva’s actual `MD_COMPONENTS`; the earlier claim that MD_COMPONENTS are class-only wrappers is false — they remap `h1`/`h2`→`h3` and `h3`/`h4`→`h4`, attach the `openExternal` click handler on `a`, and force `input type=checkbox disabled` (`message-markdown.tsx:8–51`). So this result is a **normalized library-level Markdown/React semantic comparison, not Revva DOM/UI parity**; the actual-component browser security/layout gate remains unmet. Both sides normalized only for: class/id removal, thead/tbody unwrap (md4x keeps them; react-markdown unwraps), `<br>`-adjacent newline, list-edge whitespace, `<img alt="">` default, `align` attribute vs `style="text-align:..."` — all adapter-mechanical. Result: **25 MATCH / 31, 6 DIFF** (`eqLiteral`, `dollarLiteral`, `frontmatter`, `footnote`, `callout`, `headingAttr`): five are md4x fixed-dialect semantic differences, one (`footnote`) is a minimal-adapter gap — both parsers *recognize* footnotes, my throwaway adapter merely renders `footnote-ref`/`footnotes` as passthrough fragments and leaks the note text:
- `==b==` → `<mark>` strips the literal `==` (baseline: literal text). Fixed dialect.
- `$x$` / `$$y$$` → `math` nodes strip `$` (baseline literal). LLM prose with dollar amounts/inline math silently loses characters. Fixed dialect.
- `---\ntitle: t\n---` frontmatter consumed entirely (baseline renders `<hr/><h2>`). Fixed dialect.
- `# Real {#custom}` id-attribute parsed, `{#custom}` deleted (baseline literal). Fixed dialect.
- `> [!NOTE]` → `alert`, the marker line deleted (baseline literal inside blockquote). Fixed dialect.
- `text[^1]` + definition: md4x emits `footnote-ref`/`footnotes` nodes; baseline renders sup/section markup. **Adapter gap, not a dialect difference** — near-equivalent output is implementable but is real work, and my minimal probe leaked the note text.
- Additional verified case from the separate `probe-dialect.mjs` battery (NOT one of the 31-case corpus DIFFs; the corpus `braceLiteral` case, `{ a, b } … {x=1}` mid-paragraph, MATCHed): `{x=1}` **at end of a paragraph line** is consumed as a block attribute bag and can drop trailing text. JS/config snippets ending a line with `…} {x=1}` are at risk.
- Matched importantly: ordinary GFM (headings/emphasis/lists/loose lists/tables incl. escapes and inline md/refs/entities/Unicode/indented+fenced code/autolinks), raw HTML block+inline **rendered as literal text identically**, disabled task checkboxes (md4x gives `li{task,checked}` — checkbox must be synthesized by the adapter), `::before` stays literal.
- Security parity is implementable but mandatory: md4x leaves `javascript:alert(1)` href raw in the AST; the adapter must apply react-markdown’s exported `defaultUrlTransform` (probe confirmed it nulls `javascript:`/`JaVaScRiPt:`/`vbscript:`/`data:text/html` and trims spaces) — same rule react-markdown applies internally. This was checked at library level only; end-to-end link-handler/external-open security in the real component tree is a still-unmet adoption gate.
- Gap signal on the 50K-character realistic doc: only `h2.id` and `code.class` props dropped by the allowlist — no unexpected tags in ordinary mixed content.
- Integration note: to keep Revva’s exact DOM (`contains-task-list` classes flowing through `{...props}`, the h1→h3 remaps, the openExternal anchor handler), an adoption adapter must reproduce remark-gfm className props *and* MD_COMPONENTS element mapping/behavior — untested here.

### Comparative numbers — parser + conversion pipeline microbench, pre-020, **NOT end-to-end, NOT a fallback comparison, NOT the post-020 baseline**
Deterministic mixed-markdown workload: `bench.mjs`/`benchdoc.mjs` generate **50,000 UTF-16 code units (50,228 bytes, 1,596 lines)** — the loop stops on `.length`, so it is a 50K-character doc, not an exact 50K-byte one. Content: headings/paragraph/links/autolinks/lists/tasks/tables w/ alignment/quote/ts fence/refs. `node --expose-gc bench.mjs` in sandbox. Current side = `unified+remark-parse+remark-gfm+remark-rehype` runSync (react-markdown’s parse+convert work, excl. to-jsx-runtime); candidate side = `md4x parseAST + allowlist adapter walk to React elements`:
- Full parse, median of 41 interleaved: current **39.5 ms** vs md4x **3.7 ms** (≈10.6×).
- Streaming append schedule (200 × 250-char appends, full re-parse each tick, median of 11): cumulative **3,292.8 ms** vs **338.2 ms** (≈9.7×).
- Including React: full `renderToStaticMarkup` of `ReactMarkdown` vs md4x parse+adapter+same React render, median of 21: **44.5–47.1 ms** vs **4.9–5.1 ms** (≈9×). Caveat: server markup, no browser DOM mount/layout/paint; the raw-React render portion is shared and small, which is why the ratio stays high.
- Cold/one-time (fresh Node processes, 3 runs, `cold.mjs`): import 1.2–2.5 ms, `init()` decode+inflate+instantiate 3.4–4.4 ms. WASM linear memory not isolable from JS heap (process RSS 55.7 MiB after init+parse, not attributable to WASM).
- Bundle inventory (node_modules disk inventory only, `node -e` du over the react-markdown+remark-gfm dependency tree): current chain resolves 99 packages / 1,393,613 B of raw unminified js/mjs/cjs; md4x standalone is a single 130,860 B module (105,047 B gzip) including inlined WASM. This is **not** a production-bundle measurement (no bundler, minification, tree-shaking or source-map accounting), the parser lives in the **renderer** bundle, not the Electron main bundle, and an assistant-only replacement would still retain react-markdown for user bubbles/Inbox/PR/changelog paths — therefore **no app bundle-size shrink claim is supportable from these counts**.
- `md4x renderToHtml` (context only, not React-compatible): 0.55 ms; `parseAST + JSON.stringify`: 1.28 ms — JSON materialization is cheap.
- `md4w mdToJSON` context (`md4w-bug.mjs`, ASCII 50,000-char/50,000-byte no-title variant doc): median 1.60–1.70 ms across two runs — fast but disqualified by the invalid-JSON link-title bug above.

### Decision for this phase
**RESEARCH COMPLETE — adoption DEFERRED (not rejected on speed).** Parser-level gains are large and reproducible, but all three adoption preconditions are unmet here:
1. Fixed super-GFM dialect silently rewrites ordinary assistant prose (`$…$`, `==…==`, line-end `{x=1}`, frontmatter, `[!NOTE]`, `{#id}`) with no parser flags to disable it; any future adapter needs documented behavior deltas or a line-level fallback, and the plan forbids silent prose changes.
2. End-to-end comparison must run on the approved post-020 cached path in the real renderer with Revva’s actual `MD_COMPONENTS` (browser profiling/GUI gate, link-handler/external-open security, heading-remap layout) — owned by another executor and not available in this phase; this phase’s library-level probe does not substitute, and parser-only numbers explicitly do not satisfy the ≥20% acceptance bar. Do not start the post-020 comparison until the coordinator supplies the approved baseline.
3. Production CSP (`src/renderer/index.html:9`, `script-src 'self'`) lacks `wasm-unsafe-eval`; WASM instantiation would be blocked. The separately reviewed CSP change is an adoption gate, deliberately not performed.
No production source, dependency, lockfile, CSP or test changes were made; only this plan section is committed on `research/markdown-parser-spike`. Sandbox scripts (`cases/adapter/probe-compat/bench/bench-render/cold/bench-md4w/md4w-bug/urlcheck/sizes.mjs`) remain in the approved temp dir for review.

### Review corrections applied (round 1, 2026-10-30)
Coordinator independently reproduced `node probe-compat.mjs` (25 MATCH/31, 6 DIFF) and `node md4w-bug.mjs` (title throw) in this sandbox. Four accuracy fixes to the section above, verified against the scratch files before editing:
1. Diagnosis split: of the six corpus DIFFs (`eqLiteral`, `dollarLiteral`, `frontmatter`, `footnote`, `callout`, `headingAttr`), five are fixed-dialect semantics; `footnote` is an adapter gap (both parsers recognize footnotes). Line-end `{x=1}` text-loss is a separate verified `probe-dialect.mjs` case, not one of the six.
2. Baseline uses default react-markdown components, not `MD_COMPONENTS` (which remaps h1/h2→h3, h3/h4→h4 and adds handlers) — results are library-level semantic comparison only; Revva DOM/UI parity and component-level security/layout gates remain unmet.
3. Bundle numbers demoted to node_modules disk inventory; renderer (not main) bundle; react-markdown retained for other render paths even under assistant-only adoption — no bundle-shrink claim.
4. Workload is 50,000 UTF-16 characters = 50,228 bytes (`node sizes.mjs`); md4w variant is 50,000 chars = 50,000 bytes (ASCII). All microbench labels re-stated as pre-020 parser-pipeline server microbench, not end-to-end or fallback.
Conclusions unchanged: md4x concrete prose-rewriting cases and the md4w invalid-JSON bug stand as verified; production parser unchanged; CSP not weakened; adoption stays DEFERRED.
