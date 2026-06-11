# Pi-Goal

Pi-Goal brings Codex-style long-running goals to pi. It keeps an in-memory thread objective moving across turns, repeated auto-compaction, provider errors, and queued user messages while preserving user control with `/goal pause`, `/goal resume`, and `/goal clear`.

## Install and How to Use

```sh
pi install npm:@kky42/pi-goal
```

Use `/goal` from any pi session:

```text
/goal
/goal Build the requested feature and verify it end to end
/goal pause
/goal resume
/goal clear
```

`/goal <objective>` creates an active in-memory goal, displays the full goal summary, and asks the agent to continue immediately. Normal goal starts and continuations are delivered as pi user follow-ups; the current objective, usage, and completion rules are injected as hidden provider context before each model call. Goal state is intentionally not persisted across pi process restarts.

## Pi-Goal vs. Codex Goal

| Area | Pi-Goal | Codex Goal |
| --- | --- | --- |
| Availability | Installable pi package: `pi install npm:@kky42/pi-goal` | Built into Codex |
| Goal start | `/goal <objective>` stores an in-memory thread-scoped goal and sends a continuation follow-up | Native goal initialization in the Codex thread |
| Continuation | Scheduler-owned pi user follow-ups after idle; queued user messages win | Native Codex continuation loop |
| State | In memory only; robust across auto-compaction in the same pi process, intentionally lost on restart | Stored in Codex's internal thread goal state |
| Completion | Agent marks `complete` only after a completion audit via `update_goal` | Same completion-audit contract |
| Blocked state | Agent can mark `blocked`; `/goal resume` reactivates paused or blocked goals | Same blocked/resume behavior |
| Token budget | Runtime supports budget-limited goals, but `/goal` starts with no budget in this simplified flow | Native Codex goal budget handling |
| Prompt caching | Continuation prompts stay compact; current goal state is injected fresh as hidden provider context | Managed by Codex internals |
| Main difference | Codex-style goal behavior implemented as an inspectable pi extension with minimal session persistence | First-party Codex implementation |
