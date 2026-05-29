# Pi-Goal

Pi-Goal brings Codex-style persistent goals to pi. It keeps a thread-scoped objective moving across turns, resumes, forks, compaction, provider errors, and queued user messages while preserving user control with `/goal pause`, `/goal resume`, and `/goal clear`.

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

`/goal <objective>` creates an active goal, displays the full goal summary, and asks the agent to continue immediately. Token budgets are set through the goal tool, matching Codex behavior, rather than parsed from `/goal --tokens`.

## Pi-Goal vs. Codex Goal

| Area | Pi-Goal | Codex Goal |
| --- | --- | --- |
| Availability | Installable pi package: `pi install npm:@kky42/pi-goal` | Built into Codex |
| Goal start | `/goal <objective>` stores a thread-scoped goal and sends full goal context to the agent | Native goal initialization in the Codex thread |
| Continuation | Scheduler-owned hidden continuations after idle; queued user messages win | Native Codex continuation loop |
| State | Persisted as pi session custom entries, so it survives resume, fork, tree navigation, reload, and compaction | Stored in Codex's internal thread goal state |
| Completion | Agent marks `complete` only after a completion audit via `update_goal` | Same completion-audit contract |
| Blocked state | Agent can mark `blocked`; `/goal resume` reactivates paused or blocked goals | Same blocked/resume behavior |
| Token budget | Optional model-side budget; reaching it marks the goal `budgetLimited` and asks the agent to wrap up | Native Codex goal budget handling |
| Prompt caching | Historical continuation prompts stay byte-stable; stale continuations are dropped at runtime using metadata | Managed by Codex internals |
| Main difference | Codex-style goal behavior implemented as an inspectable pi extension | First-party Codex implementation |
