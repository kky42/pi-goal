import type { ThreadGoal } from "./types.js";

type GoalToolName = "update_goal";

export function goalToolReference(toolName: GoalToolName): string {
  return toolName;
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

export function continuationPrompt(goal: ThreadGoal): string {
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
