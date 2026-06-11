import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { GoalPersistence } from "./goal-persistence.js";
import type { StatusContext } from "./goal-runtime-status.js";
import {
  applyGoalTransitionEffects,
  planGoalTransition,
  type GoalTransitionEffect,
  type GoalTransitionEffectHandlers,
  type GoalTransitionRequest,
} from "./goal-transition.js";
import {
  applyHostOverflowUserResetPersistence,
  beginHostOverflowRecovery,
  requireHostOverflowUserReset,
  type GoalRecoveryMachineState,
} from "./recovery-machine.js";
import {
  goalsEquivalent,
  updateGoalStatus,
} from "./state.js";
import type { GoalEntrySource, GoalResult, ThreadGoal } from "./types.js";

interface GoalStateControllerDeps {
  pi?: unknown;
  persistence: GoalPersistence;
  getRecoveryState: () => GoalRecoveryMachineState;
  transitionEffectHandlers: GoalTransitionEffectHandlers;
  refreshUi: (ctx: StatusContext) => void;
}

function reloadRuntimeEffects(
  previousGoalId: string | null,
  reconstructed: ThreadGoal | null,
): GoalTransitionEffect[] {
  const effects: GoalTransitionEffect[] = [{ type: "clearContinuation" }];
  if (reconstructed?.status !== "active") {
    effects.push({ type: "clearActiveAccounting" });
  }
  if ((reconstructed?.goalId ?? null) !== previousGoalId) {
    effects.push({ type: "resetRecovery" });
  }
  return effects;
}

export interface GoalStateController {
  applyGoalTransition: (
    request: GoalTransitionRequest,
    ctx: StatusContext | null,
  ) => boolean;
  beginOverflowRecovery: (ctx: StatusContext) => void;
  updateGoal: (status: "complete" | "blocked", source: GoalEntrySource, ctx: ExtensionContext) => GoalResult;
  flushGoalPersistence: GoalPersistence["flushGoalPersistence"];
  getGoal: () => ThreadGoal | null;
  isCurrentActiveGoalId: (goalId: string) => boolean;
  maybeFlushRuntimePersistence: GoalPersistence["maybeFlushRuntimePersistence"];
  pauseForAbort: (ctx: ExtensionContext) => void;
  persistHostOverflowUserReset: (needsReset: boolean) => void;
  reloadFromSession: (ctx: ExtensionContext) => void;
  resumePausedGoal: (ctx: ExtensionContext) => void;
}

export function createGoalStateController(deps: GoalStateControllerDeps) {
  const getGoal = (): ThreadGoal | null => deps.persistence.getGoal();

  const isCurrentActiveGoalId = (goalId: string): boolean =>
    getGoal()?.goalId === goalId && getGoal()?.status === "active";

  const applyGoalTransition = (
    request: GoalTransitionRequest,
    ctx: StatusContext | null,
  ): boolean => {
    const plan = planGoalTransition(getGoal(), request);

    applyGoalTransitionEffects(plan.beforePersist, deps.transitionEffectHandlers);

    if (plan.persist === "clear") {
      const clearedGoalId = getGoal()?.goalId ?? null;
      deps.persistence.appendClearEntry(clearedGoalId, plan.source);
      applyGoalTransitionEffects(plan.afterPersist, deps.transitionEffectHandlers);
      if (ctx) {
        deps.refreshUi(ctx);
      }
      return true;
    }

    if (plan.persist === "skip") {
      applyGoalTransitionEffects(plan.afterPersist, deps.transitionEffectHandlers);
      if (ctx) {
        deps.refreshUi(ctx);
      }
      return false;
    }

    if (plan.persist === "defer") {
      deps.persistence.setGoalSnapshot(plan.nextGoal);
      if (ctx) {
        deps.refreshUi(ctx);
      }
      return false;
    }

    deps.persistence.setGoalSnapshot(plan.nextGoal);
    const persisted = deps.persistence.flushGoalPersistence(plan.source);
    applyGoalTransitionEffects(plan.afterPersist, deps.transitionEffectHandlers);
    if (ctx) {
      deps.refreshUi(ctx);
    }

    return persisted;
  };

  const persistHostOverflowUserReset = (needsReset: boolean): void => {
    applyHostOverflowUserResetPersistence(deps.getRecoveryState(), needsReset);
  };

  const beginOverflowRecovery = (ctx: StatusContext): void => {
    const goal = getGoal();
    const hasActiveGoal = Boolean(goal && goal.status === "active");
    let shouldPersist: boolean;

    if (hasActiveGoal) {
      applyGoalTransitionEffects([{ type: "clearContinuation" }], deps.transitionEffectHandlers);
      const { persistHostOverflowCapReset } = beginHostOverflowRecovery(deps.getRecoveryState());
      shouldPersist = persistHostOverflowCapReset;
      deps.refreshUi(ctx);
    } else {
      shouldPersist = requireHostOverflowUserReset(deps.getRecoveryState());
    }

    if (shouldPersist) {
      applyHostOverflowUserResetPersistence(deps.getRecoveryState(), true);
    }
  };

  const reloadFromSession = (ctx: ExtensionContext): void => {
    const current = getGoal();
    deps.persistence.syncPersistedSnapshot(current);
    applyGoalTransitionEffects(
      reloadRuntimeEffects(current?.goalId ?? null, current),
      deps.transitionEffectHandlers,
    );
    deps.refreshUi(ctx);
  };

  const pauseForAbort = (ctx: ExtensionContext): void => {
    const goal = getGoal();
    if (!goal || goal.status !== "active") {
      return;
    }

    applyGoalTransition({ kind: "abort_pause" }, ctx);
  };

  const resumePausedGoal = (ctx: ExtensionContext): void => {
    const goal = getGoal();
    if (!goal || (goal.status !== "paused" && goal.status !== "blocked")) {
      return;
    }

    applyGoalTransition({ kind: "resume_active" }, ctx);
  };

  const updateGoal = (
    status: "complete" | "blocked",
    source: GoalEntrySource,
    ctx: ExtensionContext,
  ): GoalResult => {
    const goal = getGoal();
    const result = updateGoalStatus(goal, status);
    if (!result.ok || !result.goal) {
      return result;
    }
    if (goal && goalsEquivalent(goal, result.goal)) {
      return result;
    }
    applyGoalTransition({ kind: "set", nextGoal: result.goal, source }, ctx);
    return result;
  };

  const controller: GoalStateController = {
    applyGoalTransition,
    beginOverflowRecovery,
    updateGoal,
    flushGoalPersistence: deps.persistence.flushGoalPersistence,
    getGoal,
    isCurrentActiveGoalId,
    maybeFlushRuntimePersistence: deps.persistence.maybeFlushRuntimePersistence,
    pauseForAbort,
    persistHostOverflowUserReset,
    reloadFromSession,
    resumePausedGoal,
  };

  return controller;
}
