# Pi-Goal

Pi-Goal brings Codex-style long-running goals to pi. It keeps a thread objective moving across turns, auto-compaction, provider errors, and queued user messages while preserving user control with `/goal pause`, `/goal resume`, and `/goal clear`.

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

`/goal <objective>` creates an active thread goal, shows `Goal set.`, and sends the agent a visible goal-wrapper message. The same wrapper is used for initial goal starts, resumes, and automatic continuations, so the UI shows the same goal contract that the agent receives. `update_goal` remains registered as the only goal tool; the extension no longer adds always-on goal guidance to the system prompt or injects hidden active-goal context.

Model-facing wrapper shape:

```xml
<goal>
<objective>
...
</objective>
<instructions>
You are working on this active goal.
Keep making concrete progress toward the objective when low-risk next steps are available.
Do not redefine success around a smaller or easier task.
Before declaring success, verify the objective against current evidence.
When the objective is fully achieved and no required work remains, call update_goal with {"status":"complete"}.
If meaningful progress is impossible without user input or an external change, call update_goal with {"status":"blocked"}.
</instructions>
</goal>
```

## Pi-Goal vs. Codex Goal

| Area | Pi-Goal | Codex Goal |
| --- | --- | --- |
| Availability | Installable pi package: `pi install npm:@kky42/pi-goal` | Built into Codex |
| Goal start | `/goal <objective>` stores a thread-scoped goal and sends a visible wrapper follow-up | Native goal initialization in the Codex thread |
| Continuation | Scheduler-owned visible custom follow-ups after idle; queued user messages win | Native Codex continuation loop |
| State | Stored in pi session entries for the current session tree | Stored in Codex's internal thread goal state |
| Completion | Agent marks `complete` via `update_goal` from the active wrapper contract | Same completion-audit contract |
| Blocked state | Agent can mark `blocked`; `/goal resume` reactivates paused or blocked goals | Same blocked/resume behavior |
| Prompting | No always-on goal system prompt; no hidden active-goal context | Managed by Codex internals |
| Main difference | Codex-style goal behavior implemented as an inspectable pi extension | First-party Codex implementation |
