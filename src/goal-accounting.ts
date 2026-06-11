import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyUsage } from "./state.js";
import type { ThreadGoal } from "./types.js";

export interface AccountingState {
  activeGoalId: string | null;
  lastAccountedAt: number | null;
}

export interface AssistantUsage {
  input: number;
  output: number;
}

export interface AssistantTurnMessage {
  role: string;
  stopReason?: string;
  usage?: AssistantUsage;
}

export function createAccountingState(): AccountingState {
  return {
    activeGoalId: null,
    lastAccountedAt: null,
  };
}

function usageChannelTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function assistantTurnTokens(message: AssistantTurnMessage): number {
  if (message.role !== "assistant" || !message.usage) {
    return 0;
  }
  return usageChannelTokens(message.usage.input) + usageChannelTokens(message.usage.output);
}

export function isAbortedAssistantMessage(message: AssistantTurnMessage): boolean {
  return message.role === "assistant" && message.stopReason === "aborted";
}

export function isToolUseAssistantMessage(message: AssistantTurnMessage): boolean {
  return message.role === "assistant" && message.stopReason === "toolUse";
}

interface GoalAccountingDeps {
  getGoal: () => ThreadGoal | null;
  getAccounting: () => AccountingState;
  applyRuntimeAccountingTransition: (ctx: ExtensionContext, nextGoal: ThreadGoal) => void;
}

export function createGoalAccounting(deps: GoalAccountingDeps) {
  const clearActiveAccounting = (): void => {
    const accounting = deps.getAccounting();
    accounting.activeGoalId = null;
    accounting.lastAccountedAt = null;
  };

  const beginAccounting = (): void => {
    const goal = deps.getGoal();
    const accounting = deps.getAccounting();
    if (!goal || goal.status !== "active") {
      accounting.activeGoalId = null;
      accounting.lastAccountedAt = null;
      return;
    }

    accounting.activeGoalId = goal.goalId;
    accounting.lastAccountedAt = Date.now();
  };

  const accountProgress = (
    ctx: ExtensionContext,
    _includeActiveElapsed: boolean,
    completedTurnTokens = 0,
    _forceFlush = false,
  ): void => {
    const goal = deps.getGoal();
    const accounting = deps.getAccounting();
    if (!goal || accounting.activeGoalId !== goal.goalId || goal.status !== "active") {
      beginAccounting();
      return;
    }

    const now = Date.now();
    const elapsed = accounting.lastAccountedAt === null ? 0 : Math.floor((now - accounting.lastAccountedAt) / 1000);
    accounting.lastAccountedAt = now;

    const result = applyUsage(goal, completedTurnTokens, elapsed, {
      expectedGoalId: accounting.activeGoalId,
    });
    if (!result.changed || !result.goal) {
      return;
    }

    deps.applyRuntimeAccountingTransition(ctx, result.goal);
  };

  return {
    clearActiveAccounting,
    beginAccounting,
    accountProgress,
  };
}
