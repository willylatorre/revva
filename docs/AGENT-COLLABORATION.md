# Agent collaboration

## Plan

1. **Coordinator-first chats.** New chats use the OpenCode location's default primary agent, with Revva coordination instructions. Remember the project/model, not the previous agent override. Keep primary-agent overrides available inside an existing conversation; never offer subagent-only profiles as primary agents.
   Composer mentions use `#agent-name` for discovered agent profiles and retain `@file` for files. Unrecognized hashes (including ordinary PR references) remain plain text.
2. **Native child sessions.** Discover OpenCode parent/child relationships, retain a small local index for restart recovery, and show child status/output beneath the parent. Include child questions and permission requests in the Inbox. Do not create another transcript store.
3. **Scoped collaboration tools.** Attach Revva's tools through OpenCode's runtime MCP registration while Revva is running. A loopback-only server uses a random per-checkout bearer credential. Discover agent profiles, list/read Revva conversations in the same checkout, launch a bounded read-only helper, and queue a message to another writable conversation. Reads do not send prompts. Messaging requires OpenCode permission approval and cannot target controlled reviewers or finished ticket work.
4. **Verification.** Run `pnpm typecheck` and `pnpm build`; manually check new-chat defaults, child output, questions, restart recovery, approval/denial, and out-of-scope refusal. No automated tests or new testing infrastructure.

## Design and boundaries

- OpenCode owns native delegation, agent configuration, models, permissions, execution and transcripts. Revva does not replace its `subagent` tool or create agent profiles in the user's configuration.
- The coordinator is the configured primary agent, not OpenCode's built-in `general` subagent. Native delegation is preferred for specialists and completion notifications.
- Collaboration tools are registered per checkout, not globally or through a public HTTP server. Only indexed Revva sessions and their descendants may call them; only primary coordinators may launch helpers or send cross-chat messages. The caller must remain at the registered directory; targets must be in the same canonical Git checkout (or the same canonical non-Git directory), including after a session moves. Graceful shutdown removes the runtime registrations. The persisted, randomly generated server name belongs to Revva, so a restart can replace its own stale registration without touching user-defined servers.
- Native children remain children, rather than polluting the sidebar with standalone chats. Their transcripts are inspectable; follow-ups go through the coordinator/native subagent tool. Approved MCP messages can also continue the coordinator's own children, including read-only helpers, without changing their permissions. Other coordinators may read a child but cannot steer it.
- Cross-chat messaging queues a turn; it never interrupts a recipient or bypasses Revva's ticket follow-up queue. No automatic reply forwarding or broadcast exists, and sends are rate-limited to prevent loops.
- MCP-launched helpers are read-only, cannot spawn helpers or use unrestricted Code Mode, and inherit the coordinator's model unless their selected agent specifies another. Native configured specialists retain their own OpenCode permissions; editing isolation remains the coordinator's responsibility.
- Controlled review/fixer orchestration stays separate. Read access to its output does not permit steering it.
- Active controlled review agents get read-only access to a role/round/work-specific set of related threads: the implementation conversation; for fixers, completed latest reviewer attempts in their own round; for re-reviewers, their own immediately preceding review and the successful intervening fixer. Same-round peer reviewers are deliberately not shared. Stopped/superseded agents and earlier review cycles lose access. Findings remain in the fixer prompt; optional transcript reads never determine the verdict or replace code verification.
- Existing chats and agent overrides are not silently migrated. Opening a chat installs coordination instructions and connects tools without prompting it.
- Review refuses active or queued implementation descendants and blocks Revva child follow-ups until the gate finishes. Independent OpenCode clients can still resume a session outside Revva; do not use them to restart implementation agents during review.
- An ordinary conversation can enable review for its current checkout using **Enable review controls**, without inventing a Jira ticket or creating a PR. Start the review separately in those controls. It uses interactive mode with no automatic shipping. Test-audit reviewers must honor the target repository's verification policy.

## Manual acceptance checklist

- Open New chat after switching an old conversation's agent: project/model are remembered, agent is not.
- Ask the coordinator to use a discovered specialist; inspect the child status/transcript, and answer a child question in the Inbox.
- Restart Revva and inspect the same child session without launching another.
- Ask an agent to read a same-checkout conversation: no new turn should appear there.
- Ask it to send a follow-up to another same-checkout chat: approve/reject the permission request and confirm delivery only after approval.
- Try unknown sessions, another checkout, self-messaging, and reviewer/fixer targets: writes must be refused.
- Launch a read-only helper, inspect its output, and confirm edit/shell/spawn/message tools are unavailable. A failed prompt must leave the helper available for inspection, not erase partial state.
- Disconnect/reconnect OpenCode and move a chat: registrations recover without editing any config file; old-checkout tools cannot access the moved session.
- During review, confirm the fixer can read its current completed reviewer reports and a re-reviewer can read its own previous report/fixer summary. Same-round peer reviews, unrelated tickets, stopped attempts and older manual review cycles must be refused; no review agent can message or launch another agent through Revva.

## Verification performed

- `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Ran an isolated-app-data `pnpm dev` preview against the installed OpenCode 2.0.30 service. Confirmed runtime MCP connection, discovered the real agent inventory, read an empty chat/child without waking it, and verified unknown-session and cross-checkout refusal.
- Created a read-only child session without prompting it and confirmed its parent/root identity and renderer-facing listing. A messaging permission evaluated to `ask`; rejecting it cleared the pending request.
- Visually inspected the simplified New chat dialog. The UI detector reported no findings.
- A complete model-driven delegated task, child-output dialog at minimum window size, child questions, and approved message delivery still need a manual pass. No prompts were sent to existing user conversations for verification.
- Round 1 fixes were typechecked and built, but the full delegation, approval/denial, reconnect/move and review-handoff matrix remains unverified end-to-end. An isolated app-data preview lacked GitHub authentication; no model-driven tasks were run and no reviewers or existing conversations were contacted.
- Round 2 fixes passed typecheck, build, and the UI detector. The full manual matrix remains unverified: review-agent launches were prohibited, and an isolated app-data preview still reconciled existing sessions from the shared OpenCode service. No prompts were sent; a separate isolated OpenCode service is needed for a safe manual pass.
- Round 4 fixes: the isolated-service acceptance matrix and rendered minimum-height states remain unverified. This fixer was explicitly prohibited from launching agents or reviewers; no existing sessions were contacted. A separate authorized manual pass is still required.
- Round 5 fixes: the complete isolated-service acceptance matrix remains unverified. This fixer was explicitly prohibited from launching or contacting agents and reviewers, so delegation, child questions, approved delivery and review handoffs cannot be exercised. A separately authorized manual pass is still required.
