import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { goalToolResponse, toToolText, type GoalToolResponse } from "./format.js";
import { TOOL_PROMPT_GUIDELINES } from "./prompts.js";
import type { GoalEntrySource, GoalResult, ThreadGoal } from "./types.js";

const UpdateGoalParams = Type.Object({
  status: StringEnum(["complete", "blocked"] as const, {
    description:
      "Set to complete only when the objective is achieved and no required work remains. Set to blocked only after the strict blocked audit is satisfied.",
  }),
});

export interface ToolHost {
  getGoal(): ThreadGoal | null;
  updateGoal(status: "complete" | "blocked", source: GoalEntrySource, ctx: ExtensionContext): GoalResult;
}

function textResult(
  text: string,
  goal: ThreadGoal | null,
  includeCompletionBudgetReport = false,
): AgentToolResult<GoalToolResponse & { error: string | null }> {
  return {
    content: [{ type: "text", text }],
    details: { ...goalToolResponse(goal, includeCompletionBudgetReport), error: null },
  };
}

function throwToolError(message: string): never {
  throw new Error(message);
}

export function registerGoalTools(pi: ExtensionAPI, host: ToolHost): void {
  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description:
      "Mark the current Codex-style goal complete or blocked. Complete requires verified achievement. Blocked requires the strict repeated-blocker audit; pause, resume, and budget limits are user/system controlled.",
    promptSnippet:
      "Mark the current goal complete after a completion audit, or blocked only after the strict repeated-blocker audit is satisfied.",
    promptGuidelines: TOOL_PROMPT_GUIDELINES,
    parameters: UpdateGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = host.updateGoal(params.status, "tool", ctx);
      if (!result.ok || !result.goal) {
        throwToolError(result.message);
      }
      return textResult(toToolText(result.goal, true), result.goal, true);
    },
  });
}
