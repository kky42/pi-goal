import type { ThreadGoal } from "./types.js";

const CONTINUATION_MARKER_PREFIX = "<pi_goal_continuation goal_id=\"";

/**
 * Kept as empty exports for older tests/importers. pi-goal no longer injects
 * update_goal guidance into the always-on system prompt.
 */
export const GOAL_TOOL_NAME_GUIDANCE = "";
export const TOOL_PROMPT_GUIDELINES: string[] = [];

type GoalToolName = "update_goal";

export function goalToolReference(toolName: GoalToolName): string {
  return toolName;
}

export function continuationGoalIdFromPrompt(prompt: string): string | null {
  if (!prompt.startsWith(CONTINUATION_MARKER_PREFIX)) {
    return null;
  }
  const end = prompt.indexOf("\"", CONTINUATION_MARKER_PREFIX.length);
  if (end === -1) {
    return null;
  }
  return prompt.slice(CONTINUATION_MARKER_PREFIX.length, end);
}

export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatGoalWrapper(goal: ThreadGoal): string {
  return [
    "<pi-goal>",
    "<objective>",
    escapeXmlText(goal.objective),
    "</objective>",
    "<instructions>",
    "You are working on this active pi-goal.",
    "Keep making concrete progress toward the objective when low-risk next steps are available.",
    "Do not redefine success around a smaller or easier task.",
    "Before declaring success, verify the objective against current evidence.",
    'When the objective is fully achieved and no required work remains, call update_goal with {"status":"complete"}.',
    'If meaningful progress is impossible without user input or an external change, call update_goal with {"status":"blocked"}.',
    "</instructions>",
    "</pi-goal>",
  ].join("\n");
}

export function compactContinuationPrompt(goal: ThreadGoal): string {
  return formatGoalWrapper(goal);
}

export function continuationPrompt(goal: ThreadGoal): string {
  return formatGoalWrapper(goal);
}

/** Deprecated legacy helper; new continuations use visible custom messages with hidden details. */
export function markedContinuationPrompt(goal: ThreadGoal): string {
  return formatGoalWrapper(goal);
}

export function supersededContinuationMessage(goalId: string): string {
  return [
    "Superseded hidden goal continuation bookkeeping.",
    `Goal id: ${goalId}.`,
    "A newer continuation for this active goal appears later in context.",
    "Ignore this message; do not perform work for it or mention it to the user.",
  ].join("\n");
}

/** Deprecated compatibility export. Hidden active-goal context is no longer injected. */
export function activeGoalContextPrompt(goal: ThreadGoal): string {
  return formatGoalWrapper(goal);
}

/** Deprecated compatibility export. Token budgets are no longer supported. */
export function budgetLimitPrompt(goal: ThreadGoal): string {
  return formatGoalWrapper(goal);
}
