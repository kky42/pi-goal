import { RUNTIME_PERSIST_INTERVAL_MS } from "./runtime-config.js";
import { cloneGoal, goalsEquivalent } from "./state.js";
import type { GoalEntrySource, ThreadGoal } from "./types.js";

export function createGoalPersistence(_deps?: unknown) {
  let goal: ThreadGoal | null = null;
  let lastPersistedGoal: ThreadGoal | null = null;
  let lastRuntimePersistAt: number | null = null;

  const getGoal = (): ThreadGoal | null => goal;

  const setGoalSnapshot = (nextGoal: ThreadGoal | null): void => {
    goal = nextGoal;
  };

  const syncPersistedSnapshot = (snapshot: ThreadGoal | null): void => {
    lastPersistedGoal = snapshot ? cloneGoal(snapshot) : null;
    lastRuntimePersistAt = null;
  };

  const flushGoalPersistence = (_source: GoalEntrySource): boolean => {
    if (!goal) {
      return false;
    }
    if (lastPersistedGoal && goalsEquivalent(goal, lastPersistedGoal)) {
      return false;
    }

    lastPersistedGoal = cloneGoal(goal);
    lastRuntimePersistAt = Date.now();
    return false;
  };

  const maybeFlushRuntimePersistence = (source: GoalEntrySource): void => {
    if (!goal || goal.status !== "active") {
      return;
    }
    const now = Date.now();
    if (lastRuntimePersistAt !== null && now - lastRuntimePersistAt < RUNTIME_PERSIST_INTERVAL_MS) {
      return;
    }
    flushGoalPersistence(source);
  };

  const clearGoalSnapshot = (): void => {
    goal = null;
    lastPersistedGoal = null;
    lastRuntimePersistAt = null;
  };

  const appendClearEntry = (_clearedGoalId: string | null, _source: GoalEntrySource): void => {
    clearGoalSnapshot();
  };

  return {
    appendClearEntry,
    flushGoalPersistence,
    getGoal,
    maybeFlushRuntimePersistence,
    setGoalSnapshot,
    syncPersistedSnapshot,
  };
}

export type GoalPersistence = ReturnType<typeof createGoalPersistence>;
