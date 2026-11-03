# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron desktop app (single window; `web` is the design language — no native iOS/Android surfaces).

## Users

Adrian, the primary user, works it daily as his own engineering cockpit: Jira sprint in, reviewed PRs out, driven by opencode sessions. Secondary audience, confirmed: onboarding a teammate must work — a new user installs, connects their own OpenCode/Jira/AWS setup, and uses the app without copying Adrian's shell functions, scripts, credentials, paths, model IDs, or machine configuration (docs/REQUIREMENTS.md).

## Product Purpose

A local Electron desktop cockpit that turns a Jira sprint into shipped, reviewed pull requests via OpenCode agent sessions the user controls from one window. Success means the daily loop — pick ticket → agent builds → parallel reviews → fix rounds → PR + Jira transition — runs from this one surface with the user interrupting only at real decision points.

## Positioning

It orchestrates the user's *own* OpenCode service rather than bundling an assistant: every agent, model, and skill exposed by the connected service is eligible and discovered live (nothing hardcoded), reviews fan out to parallel read-only reviewers (sol-loop, a cross-model rigor reviewer, impeccable UI review) fanning in to one fixer with bounded re-review rounds, and shipping stays human-owned — Revva opens PRs but never merges. Competitors embed a model; Revva is a control room for a pipeline the user already owns.

## Operating Context

- The user's machine: their OpenCode service, `gh`/`gh-stack` CLI, git worktrees under workspace folders the user authorizes, AWS/SSO routines run as opaque user shell scripts (Revva does not model what they do).
- Jira Cloud via Revva's own OAuth connection (never another app's token cache); GitHub via `gh`.
- Long autonomous runs are the norm: keep-awake toggle, triage inbox for questions/permissions/finished runs, live streaming transcripts.
- Windows and macOS (Apple Silicon) are the shipped targets; builds are ad-hoc signed (no Developer ID) for now.

## Capabilities and Constraints

- Pipeline: ticket → worktree + branch (stacked/parent branches supported) → optional /grill-me intake → build session → parallel review gates → fixer → re-review (default 3 rounds, max 5) → opt-in push + PR + Jira transition; AUTO mode makes routine choices but never skips gates.
- General chats are first-class and stay out of the pipeline unless explicitly linked.
- Comment watcher reworks open PRs from new Jira comments.
- Verification is deliberately manual ("YOLO" policy, AGENTS.md): `pnpm typecheck` and `pnpm build` are the only automated gates; no E2E/unit-test frameworks.
- Reuse-first UI: shadcn/ui primitives own generic controls (docs/FRONTEND.md); main process is ESM; no hardcoded model IDs, provider names, AWS profiles, or paths.
- Every user-visible change gets a `## [Unreleased]` CHANGELOG.md bullet in the same change; version bumps are the owner's call.
- Undecided: whether Revva is ever positioned publicly beyond the small-team circle.

## Brand Commitments

- Name renders lowercase — **revva** — in app chrome (README, sidebar wordmark); "Revva" capitalization only in prose.
- Wordmark: lowercase *revva* set in Space Grotesk (self-hosted `@fontsource-variable/space-grotesk`, `--font-display` token), baseline-locked with the app-version badge. Locked by the owner 2026-10-30; everything else stays on the system UI face.
- Icon assets: `build/icon.icns` / `icon.png` / `icon.svg`.
- Voice: plain-spoken, honest about state (e.g. "Removed from Revva, but…" notes instead of silent success); no marketing gloss in UI copy.

## Evidence on Hand

- Real screenshot set: `docs/images/` (dashboard, inbox, jira, github, cockpit, scripts) referenced from README.
- Live product docs: README.md feature list (mirrored in-app under Setup → Features), docs/REQUIREMENTS.md, docs/ARCHITECTURE.md, docs/PIPELINE.md, CHANGELOG.md.
- Shipped releases with installers on GitHub (willylatorre/revva).
- Absences future work must not fabricate: no external testimonials, case studies, customer logos, benchmarks, or pricing — none exist.

## Product Principles

1. **Drive the user's stack, don't own it** — discover (OpenCode service, models, agents, gh, git) instead of bundling or hardcoding; a fresh install on a teammate's machine is a first-class scenario.
2. **The human owns the merge** — automation runs between explicit gates; pushes are opt-in, reviews are never skipped, and every shortcut logs its choice.
3. **Interrupt only where it counts** — long runs are the default; the inbox exists so questions, permissions, and finished work queue up instead of blocking.
4. **Honest state over clean UI** — surfaces say what actually happened, including partial failures and stale instances (version/dev badge, re-check-before-delete).
5. **Proportional process** — small correct patches, minimal automated testing, manual verification; ceremony pays only when complexity warrants it.

## Accessibility & Inclusion

No formal standard committed (owner decision 2026-10-30). Baseline expectations remain: shadcn/Radix keyboard navigation and visible focus rings, readable contrast in both themes.
