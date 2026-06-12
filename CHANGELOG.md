# Changelog

## Unreleased

- Restores live elapsed active time in the `Pursuing goal` footer label and covers the 1s refresh timer against duplicate intervals; paused goals freeze elapsed time and resume from prior usage.

## 1.0.5 - 2026-06-11

- Removes old continuation-marker parsing, superseded-continuation bookkeeping, provider-context rewrite shell, and compatibility prompt exports; queued goal work is identified by message metadata only.
- Tightens the `update_goal` tool description so agents are told not to call it unless they are working inside an active `<goal>` message.
- Adds a provider-backed e2e regression for ordinary prompts with `Goal:` sections and runs real e2e tests three times by default (`PI_GOAL_REAL_E2E_REPEATS` overrides this).

## 1.0.4 - 2026-06-11

- Sends `/goal` starts, resumes, and automatic continuations through the same visible goal custom-message wrapper so the UI content matches the model-facing prompt.
- Removes always-on goal tool prompt guidance and hidden active-goal provider context; `update_goal` guidance now appears only inside active goal work messages.
- Removes obsolete prompting/limit behavior from the simplified goal loop.
- Persists goal snapshots through pi custom session entries again so session reloads can reconstruct active goals and host-overflow reset state.
- Updates unit and real e2e coverage for interactive and headless goal-wrapper flows.

## 1.0.3 - 2026-06-11

- Temporarily masks model-facing `get_goal` and `create_goal`, leaving `update_goal` as the only registered goal tool.
- Simplifies goal runtime state to in-memory snapshots and stops writing pi-goal custom session entries, reducing coupling to pi session persistence and compaction internals.
- Sends goal continuations as pi-native user follow-ups and injects authoritative active-goal context before each provider call so repeated auto-compaction preserves the goal loop in-process.
- Keeps headless `/goal <objective>` running through scheduled continuations and pending auto-compaction until the active goal is completed, blocked, paused, or cleared.

## 1.0.2 - 2026-05-30

- Prevents `/goal` argument autocomplete from injecting `pause`, `resume`, or `clear` into free-form goal objectives while preserving explicit subcommand completion.
- Sends overflow-recovery goal continuations as user-started follow-ups when pi's host overflow cap needs a user turn, while keeping normal continuations hidden.
- Makes headless `/goal <objective>` replace existing non-complete goals deterministically and drain scheduled goal continuations until the goal leaves `active`, instead of exiting without model output or after only the first turn.

## 1.0.1 - 2026-05-30

- Exposes the extension through a root `index.ts` package entry so pi displays the installed package as `@kky42/pi-goal` instead of `@kky42/pi-goal:src`.

## 1.0.0 - 2026-05-30

- Renames the public package to `@kky42/pi-goal` for npm and pi package installs.
- Aligns goal initialization, continuation, blocked handling, prompt cache behavior, and tool-facing goal output with the Codex-style goal contract.
- Refreshes the README around installation, usage, and the Pi-Goal vs. Codex Goal comparison for the public 1.0.0 release.

## 0.1.15 - 2026-05-27

- Refactors the goal runtime monolith into focused modules for clearer lifecycle ownership, event handling, and continuation orchestration.
- Narrows runtime handler dependency interfaces so input/context, turn, agent, and session handlers only receive the lifecycle ports they use.
- Moves goal transition effect application into a focused effect module so transition planning stays centered on goal snapshots and persistence decisions.
- Reworks the stale queued-work reducer around per-lifecycle default transition tables and focused state reducers, keeping no-op handling centralized while preserving explicit exceptional transitions.
- Removes the queued provider-context rewrite type assertion by returning typed provider-context rewrite intersections and clarifies the message normalization boundary comments.
- Hardens stale queued-work cleanup across abort, delayed terminal events, and continuation boundaries so stale work is consumed without mutating replacement-goal accounting.
- Tightens runtime continuation scheduling, recovery sequencing, and persistence/accounting handoff behavior with expanded regression coverage around lifecycle edge cases.
- Updates the local pi development baseline to `@earendil-works/*` `0.76.0` and refreshes the npm lockfile.
- Aligns recovery retry classification with Pi 0.76.0 so terminal quota, billing, and provider-limit errors do not stay pending for host retries even when they include `429` wording.
- Validates the cutover with the existing typecheck/test suite plus package metadata and dry-run pack checks.

## 0.1.14 - 2026-05-26

- Widens the package Node engine range to support Node 22.19.0 through Node 26.x.

## 0.1.13 - 2026-05-26

- Bounds hidden goal continuation provider context by superseding older active-goal continuations with short bookkeeping markers, refreshing only the latest continuation, and using compact auto-continuation prompts after `/goal` start or resume.
- Stops provider-error continuation retry storms by skipping immediate hidden requeues on `stopReason: "error"`, auto-compacting on context-window overflow when available, using bounded backoff for transient failures, and pausing with a recoverable `/goal resume` path when recovery is exhausted.
- Makes goal lifecycle transitions terminal and idempotent: duplicate `update_goal complete` calls no longer append extra session entries, completed goals cannot be paused or resumed, and runtime/compaction skips unchanged goal snapshots.
- Coalesces runtime goal persistence so repeated tool completions and unchanged compaction snapshots do not append full goal entries on every event; live footer usage stays current, and turn boundaries, shutdown, and bounded long-run intervals flush pending accounting to session history.
- Allows `create_goal` to replace a completed goal and clarifies recovery via `/goal <objective>` or `/goal clear`.
- Surfaces failed goal tool calls as real pi tool errors by throwing from tool handlers.

## 0.1.12 - 2026-05-23

- Updated the local pi development baseline to `@earendil-works/*` `0.75.5`, refreshed Node/tsx tooling, and regenerated the npm lockfile.
- Reviewed the pi `0.75.5` changelog and package guidance; the goal extension remains compatible with current extension lifecycle and package install/update behavior.

## 0.1.11 - 2026-05-21

- Cancels stale hidden goal continuations before they can reach the model after a goal is completed, cleared, or replaced.
- Keeps stale abort cleanup from charging tokens, pausing active replacement goals, persisting extra entries, or requeueing continuations during compaction and shutdown.
- Allows normal interactive and RPC prompts that paste continuation marker text to pass through instead of being treated as hidden extension follow-up work.
- Adds regression coverage for stale queued work across missing or delayed `agent_end`, late stale terminal events, compaction cleanup, and pasted marker input sources.

## 0.1.10 - 2026-05-18

- Updated the local pi package baseline to `@earendil-works/*` `0.75.3` and refreshed the npm lockfile.
- Removed tracked CueLoop runtime state from the package and ignored local `.cueloop/` artifacts.


## 0.1.9 - 2026-05-09

- Escapes goal objectives in hidden continuation prompts before embedding them in XML-style untrusted blocks.
- Keeps ordinary user prompts from silently reactivating paused goals; session resume now prompts before restarting a paused goal.
- Prevents tokens from an old in-flight turn from being charged to a replacement goal.
- Updates `/goal` summary and footer labels toward Codex-style status wording while retaining this package's 8000-character objective limit.

## 0.1.8 - 2026-05-07

- Migrates the local pi development baseline and peer metadata from deprecated `@mariozechner/*` packages to maintained `@earendil-works/*` `0.74.0`.
- Regenerates the npm lockfile against the current stable dependency graph.

## 0.1.7 - 2026-05-07

- Keeps active goals continuing after auto-compaction, including length-stop compactions.
- Prevents stale queued goal continuations from running after a goal is completed or changed.
- Strengthens completion-audit prompts and update-goal guidance so goals are marked complete only after verified completion.
- Avoids duplicate persisted completion entries from `update_goal`.

## 0.1.6 - 2026-05-06

- Clarifies README install commands for npm, pinned npm, GitHub, and pinned GitHub package installs.

## 0.1.5 - 2026-05-06

- Counts goal tokens from completed assistant input plus output usage instead of `usage.totalTokens`.
- Excludes cache read and cache write accounting channels from goal token accounting so cached provider tokens do not inflate sent and received totals.

## 0.1.4 - 2026-05-06

- Pauses active goals when pi reports an aborted assistant turn, including user Esc aborts.
- Resumes paused goals automatically on the next user-driven agent start, while keeping `/goal resume` available.
- Prevents aborted turns from immediately queueing hidden continuation messages.

## 0.1.3 - 2026-05-06

- Corrects the README behavior summary to describe completed assistant turn token accounting.

## 0.1.2 - 2026-05-06

- Counts completed assistant turn usage via pi's `usage.totalTokens` instead of using context-window deltas, so goal token totals track tokens sent and received across compaction.
- Keeps elapsed-time accounting stable before and after compaction while continuing to persist active goal state.

## 0.1.1 - 2026-05-06

- Marks pi runtime peer dependencies as optional so `pi install npm:pi-codex-goal` stays lightweight while still documenting the extension runtime contract.

## 0.1.0 - 2026-05-06

- Initial public release.
- Adds Codex-style `/goal` tracking for pi.
- Adds model-callable `get_goal`, `create_goal`, and `update_goal` tools.
- Persists goal state in pi session custom entries for resume, reload, fork, tree navigation, and compaction.
- Starts and resumes goals with hidden follow-up messages so active objectives keep moving.
- Shows live elapsed active time and compact/exact token counts in the pi footer.
