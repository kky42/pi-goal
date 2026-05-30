import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { continuationGoalIdFromPrompt, continuationPrompt, markedContinuationPrompt } from "./prompts.js";
import {
  goalStartTurnStrategy,
  recoveryPhaseBlocksContinuation,
  type GoalRecoveryMachineState,
} from "./recovery-machine.js";
import { isRecoveryPendingAttention } from "./recovery.js";
import { CONTINUATION_RETRY_MS } from "./runtime-config.js";
import type { StaleQueuedWorkGuard } from "./stale-queued-work-guard.js";
import { CUSTOM_ENTRY_TYPE, type ThreadGoal } from "./types.js";

interface ContinuationSchedulerDeps {
  pi: Pick<ExtensionAPI, "sendMessage" | "sendUserMessage">;
  getGoal: () => ThreadGoal | null;
  getRecoveryState: () => GoalRecoveryMachineState;
  staleQueuedWorkGuard: StaleQueuedWorkGuard;
  getCurrentTurnIndex: () => number | null;
}

export function createContinuationScheduler(deps: ContinuationSchedulerDeps) {
  let continuationQueuedFor: string | null = null;
  let continuationScheduledFor: string | null = null;
  let continuationTimer: ReturnType<typeof setTimeout> | null = null;
  let passthroughContinuationInput: { text: string; turnIndex: number | null } | null = null;

  const clearContinuationTimer = (): void => {
    if (continuationTimer) {
      clearTimeout(continuationTimer);
      continuationTimer = null;
    }
    continuationScheduledFor = null;
  };

  const clearContinuationState = (): void => {
    clearContinuationTimer();
    continuationQueuedFor = null;
  };

  const clearContinuationStateFor = (goalId: string): void => {
    if (continuationQueuedFor === goalId) {
      continuationQueuedFor = null;
    }
    if (continuationScheduledFor === goalId) {
      clearContinuationTimer();
    }
  };

  const markContinuationQueued = (goalId: string): void => {
    continuationQueuedFor = goalId;
  };

  const clearPassthroughContinuationInput = (): void => {
    passthroughContinuationInput = null;
  };

  const bindPassthroughContinuationInputToTurn = (turnIndex: number): void => {
    if (!passthroughContinuationInput) {
      return;
    }
    if (passthroughContinuationInput.turnIndex === null) {
      passthroughContinuationInput = { ...passthroughContinuationInput, turnIndex };
      return;
    }
    if (passthroughContinuationInput.turnIndex !== turnIndex) {
      clearPassthroughContinuationInput();
    }
  };

  const isPassthroughContinuationInput = (text: string): boolean => {
    if (!passthroughContinuationInput || passthroughContinuationInput.text !== text) {
      return false;
    }
    const currentTurnIndex = deps.getCurrentTurnIndex();
    return (
      passthroughContinuationInput.turnIndex === null ||
      passthroughContinuationInput.turnIndex === currentTurnIndex
    );
  };

  const continuationGoalIdFromRuntimePrompt = (prompt: string): string | null => {
    if (isPassthroughContinuationInput(prompt)) {
      return null;
    }
    return continuationGoalIdFromPrompt(prompt);
  };

  const notePassthroughContinuationInput = (text: string): void => {
    passthroughContinuationInput = { text, turnIndex: null };
  };

  const hasPendingRecoveryAttention = (): boolean => {
    const goal = deps.getGoal();
    return Boolean(goal?.status === "active" && isRecoveryPendingAttention(deps.getRecoveryState().attention));
  };

  const sendContinuation = (goalToContinue: ThreadGoal): void => {
    continuationQueuedFor = goalToContinue.goalId;
    if (goalStartTurnStrategy(deps.getRecoveryState().phase) === "userFollowUp") {
      deps.pi.sendUserMessage(markedContinuationPrompt(goalToContinue), { deliverAs: "followUp" });
      return;
    }
    deps.pi.sendMessage(
      {
        customType: CUSTOM_ENTRY_TYPE,
        content: continuationPrompt(goalToContinue),
        display: false,
        details: { kind: "continuation", goalId: goalToContinue.goalId },
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  };

  const requestContinuation = (ctx: ExtensionContext): boolean => {
    const goal = deps.getGoal();
    if (
      deps.staleQueuedWorkGuard.isBlockingContinuation() ||
      !goal ||
      goal.status !== "active" ||
      hasPendingRecoveryAttention() ||
      recoveryPhaseBlocksContinuation(deps.getRecoveryState().phase)
    ) {
      return false;
    }

    if (continuationQueuedFor === goal.goalId) {
      return true;
    }

    const goalId = goal.goalId;
    if (ctx.hasPendingMessages()) {
      if (continuationScheduledFor === goalId) {
        clearContinuationTimer();
      }
      return false;
    }

    if (!ctx.isIdle()) {
      if (continuationScheduledFor === goalId) {
        return true;
      }
      continuationScheduledFor = goalId;
      continuationTimer = setTimeout(() => {
        continuationTimer = null;
        continuationScheduledFor = null;
        requestContinuation(ctx);
      }, CONTINUATION_RETRY_MS);
      continuationTimer.unref?.();
      return true;
    }

    clearContinuationTimer();
    const currentGoal = deps.getGoal();
    if (
      deps.staleQueuedWorkGuard.isBlockingContinuation() ||
      !ctx.isIdle() ||
      ctx.hasPendingMessages() ||
      !currentGoal ||
      currentGoal.status !== "active" ||
      currentGoal.goalId !== goalId ||
      continuationQueuedFor === goalId ||
      hasPendingRecoveryAttention() ||
      recoveryPhaseBlocksContinuation(deps.getRecoveryState().phase)
    ) {
      return false;
    }
    sendContinuation(currentGoal);
    return true;
  };

  return {
    bindPassthroughContinuationInputToTurn,
    clearContinuationState,
    clearContinuationStateFor,
    clearContinuationTimer,
    clearPassthroughContinuationInput,
    continuationGoalIdFromRuntimePrompt,
    markContinuationQueued,
    notePassthroughContinuationInput,
    requestContinuation,
  };
}
