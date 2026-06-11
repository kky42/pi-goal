import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerGoalCommand } from "./commands.js";
import { createContinuationScheduler } from "./continuation-scheduler.js";
import { createGoalAccounting } from "./goal-accounting.js";
import { createGoalPersistence } from "./goal-persistence.js";
import {
  createGoalRuntimeEventHandlers,
  type GoalRuntimeEventHandlers,
} from "./goal-runtime-event-handlers.js";
import { registerGoalRuntimeEvents } from "./goal-runtime-events.js";
import { createGoalRuntimeState } from "./goal-runtime-state.js";
import { createGoalRuntimeStatus } from "./goal-runtime-status.js";
import { createGoalStateController } from "./goal-state-controller.js";
import { createGoalRecoveryRuntime } from "./recovery-runtime.js";
import {
  clearActiveHostOverflowRecovery,
  resetRecoveryMachine,
  setRecoveryPausedAttention,
} from "./recovery-machine.js";
import { goalWithLiveUsage } from "./state.js";
import { registerGoalTools } from "./tools.js";
import type { GoalContinuationKind, GoalEntrySource, GoalResult, ThreadGoal } from "./types.js";

export interface GoalRuntimeController extends GoalRuntimeEventHandlers {
  getGoalForDisplay(): ThreadGoal | null;
  setGoal(goal: ThreadGoal, source: GoalEntrySource, ctx: ExtensionContext): void;
  clearGoal(source: GoalEntrySource, ctx: ExtensionContext): void;
  hasPendingPostTurnWork(): boolean;
  updateGoal(status: "complete" | "blocked", source: GoalEntrySource, ctx: ExtensionContext): GoalResult;
  requestContinuation(ctx: ExtensionContext, kind?: GoalContinuationKind): boolean;
}

export function createGoalRuntimeController(pi: ExtensionAPI): GoalRuntimeController {
  const runtimeState = createGoalRuntimeState();
  const persistence = createGoalPersistence({ pi });

  const clearActiveAccounting = (): void => {
    runtimeState.accounting.activeGoalId = null;
    runtimeState.accounting.lastAccountedAt = null;
  };

  const resetErrorRecovery = (): void => {
    resetRecoveryMachine(runtimeState.recoveryState);
  };

  const goalForDisplay = () =>
    goalWithLiveUsage(
      persistence.getGoal(),
      runtimeState.accounting.activeGoalId,
      runtimeState.accounting.lastAccountedAt,
    );

  const status = createGoalRuntimeStatus({
    getGoalForDisplay: goalForDisplay,
    getGoalStatus: () => persistence.getGoal()?.status ?? null,
    getRecoveryAttention: () => runtimeState.recoveryState.attention,
  });

  const continuation = createContinuationScheduler({
    pi,
    getGoal: () => persistence.getGoal(),
    getRecoveryState: () => runtimeState.recoveryState,
    staleQueuedWorkGuard: runtimeState.staleQueuedWorkGuard,
    getCurrentTurnIndex: () => runtimeState.currentTurnIndex,
  });

  const stateController = createGoalStateController({
    pi,
    persistence,
    getRecoveryState: () => runtimeState.recoveryState,
    transitionEffectHandlers: {
      clearContinuation: continuation.clearContinuationState,
      clearActiveAccounting,
      resetRecovery: resetErrorRecovery,
      clearHostOverflowRecovery: () => {
        clearActiveHostOverflowRecovery(runtimeState.recoveryState);
      },
      setRecoveryPausedAttention: (reason: string) => {
        setRecoveryPausedAttention(runtimeState.recoveryState, reason);
      },
      markContinuationQueued: continuation.markContinuationQueued,
      stopStatusRefresh: () => status.stopStatusRefresh(),
    },
    refreshUi: (ctx) => status.refreshUi(ctx),
  });

  const goalAccounting = createGoalAccounting({
    getGoal: () => stateController.getGoal(),
    getAccounting: () => runtimeState.accounting,
    applyRuntimeAccountingTransition(ctx, nextGoal) {
      stateController.applyGoalTransition({ kind: "runtime_accounting", nextGoal }, ctx);
    },
  });

  const recoveryRuntime = createGoalRecoveryRuntime({
    getGoal: () => stateController.getGoal(),
    getRecoveryState: () => runtimeState.recoveryState,
    clearContinuationState: continuation.clearContinuationState,
    pauseGoalForRecovery(ctx, recoveryReason) {
      stateController.applyGoalTransition(
        { kind: "recovery_pause", recoveryReason },
        ctx,
      );
    },
    refreshUi: status.refreshUi,
    requestContinuation: continuation.requestContinuation,
  });

  const eventHandlers = createGoalRuntimeEventHandlers({
    pi,
    runtimeState,
    stateController,
    continuation,
    goalAccounting,
    recoveryRuntime,
    status,
    clearActiveAccounting,
    resetErrorRecovery,
  });

  const updateGoal = (
    status: "complete" | "blocked",
    source: GoalEntrySource,
    ctx: ExtensionContext,
  ): GoalResult => {
    goalAccounting.accountProgress(ctx, false, 0, true);
    return stateController.updateGoal(status, source, ctx);
  };

  return {
    getGoalForDisplay: goalForDisplay,
    setGoal(nextGoal, source, ctx) {
      stateController.applyGoalTransition({ kind: "set", nextGoal, source }, ctx);
    },
    clearGoal(source, ctx) {
      stateController.applyGoalTransition({ kind: "clear", source }, ctx);
    },
    hasPendingPostTurnWork() {
      return runtimeState.compactionInFlight;
    },
    updateGoal,
    requestContinuation: continuation.requestContinuation,
    ...eventHandlers,
  };
}

export function registerGoalRuntimeController(pi: ExtensionAPI): GoalRuntimeController {
  const controller = createGoalRuntimeController(pi);
  registerGoalTools(pi, {
    getGoal: () => controller.getGoalForDisplay(),
    updateGoal: controller.updateGoal.bind(controller),
  });
  registerGoalCommand(pi, {
    getGoal: () => controller.getGoalForDisplay(),
    setGoal: controller.setGoal.bind(controller),
    clearGoal: controller.clearGoal.bind(controller),
    hasPendingPostTurnWork: () => controller.hasPendingPostTurnWork(),
    requestContinuation: controller.requestContinuation.bind(controller),
  });
  registerGoalRuntimeEvents(pi, controller);
  return controller;
}
