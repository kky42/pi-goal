import type { ThreadGoal } from "./types.js";

export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatGoalWrapper(goal: ThreadGoal): string {
  return [
    "<goal>",
    "<objective>",
    escapeXmlText(goal.objective),
    "</objective>",
    "<instructions>",
    "You are working on this active goal.",
    "Keep making concrete progress toward the objective when low-risk next steps are available.",
    "Do not redefine success around a smaller or easier task.",
    "Before declaring success, verify the objective against current evidence.",
    'When the objective is fully achieved and no required work remains, call update_goal with {"status":"complete"}.',
    'If meaningful progress is impossible without user input or an external change, call update_goal with {"status":"blocked"}.',
    "</instructions>",
    "</goal>",
  ].join("\n");
}
