import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyGoalTransitionEffects,
  planGoalTransition,
  type GoalTransitionEffect,
  type GoalTransitionPlan,
} from "../src/goal-transition.js";
import { cloneGoal, createThreadGoal } from "../src/state.js";
import type { GoalStatus, ThreadGoal } from "../src/types.js";

function effectTypes(effects: readonly GoalTransitionEffect[]): string[] {
  return effects.map((effect) => effect.type);
}

function assertNoDuplicateEffectTypes(
  effects: readonly GoalTransitionEffect[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const effect of effects) {
    assert.equal(
      seen.has(effect.type),
      false,
      `${label}: duplicate effect type ${effect.type}`,
    );
    seen.add(effect.type);
  }
}

function assertDisjointPrimitivePlan(plan: GoalTransitionPlan, label: string): void {
  assertNoDuplicateEffectTypes(plan.beforePersist, `${label} beforePersist`);
  assertNoDuplicateEffectTypes(plan.afterPersist, `${label} afterPersist`);
  assertNoDuplicateEffectTypes([...plan.beforePersist, ...plan.afterPersist], `${label} combined`);
}

function withUnixTime<T>(unixSeconds: number, run: () => T): T {
  const originalNow = Date.now;
  Date.now = () => unixSeconds * 1000;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

type CommandSetTableCase = {
  label: string;
  build: () => { current: ThreadGoal; next: ThreadGoal };
  persist: GoalTransitionPlan["persist"];
  before: string[];
  after: string[];
};

const commandSetTable: CommandSetTableCase[] = [
  {
    label: "active skip unchanged",
    build: () => {
      const goal = createThreadGoal("ship it");
      return { current: goal, next: goal };
    },
    persist: "skip",
    before: [],
    after: [],
  },
  {
    label: "paused skip unchanged",
    build: () => {
      const goal = createThreadGoal("ship it");
      const paused = { ...cloneGoal(goal), status: "paused" as const };
      return { current: paused, next: paused };
    },
    persist: "skip",
    before: [],
    after: ["resetRecovery"],
  },
  {
    label: "active to same paused",
    build: () => {
      const goal = createThreadGoal("ship it");
      const paused = { ...cloneGoal(goal), status: "paused" as const };
      return { current: goal, next: paused };
    },
    persist: "set",
    before: ["clearContinuation", "clearActiveAccounting"],
    after: ["resetRecovery"],
  },
  {
    label: "active to different paused",
    build: () => {
      const current = createThreadGoal("old objective");
      const next = { ...createThreadGoal("new objective"), status: "paused" as const };
      return { current, next };
    },
    persist: "set",
    before: ["clearContinuation", "clearActiveAccounting", "resetRecovery"],
    after: [],
  },
  {
    label: "paused to same active",
    build: () => {
      const goal = createThreadGoal("ship it");
      const paused = { ...cloneGoal(goal), status: "paused" as const };
      const active = { ...cloneGoal(goal), status: "active" as const };
      return { current: paused, next: active };
    },
    persist: "set",
    before: [],
    after: ["resetRecovery"],
  },
  {
    label: "blocked to same active",
    build: () => {
      const goal = createThreadGoal("ship it");
      const blocked = { ...cloneGoal(goal), status: "blocked" as const };
      const active = { ...cloneGoal(goal), status: "active" as const };
      return { current: blocked, next: active };
    },
    persist: "set",
    before: [],
    after: ["resetRecovery"],
  },
];

for (const tableCase of commandSetTable) {
  test(`planGoalTransition command set table: ${tableCase.label}`, () => {
    const { current, next } = tableCase.build();
    const plan = planGoalTransition(current, {
      kind: "set",
      nextGoal: next,
      source: "command",
    });

    assertDisjointPrimitivePlan(plan, tableCase.label);
    assert.equal(plan.persist, tableCase.persist);
    assert.deepEqual(effectTypes(plan.beforePersist), tableCase.before);
    assert.deepEqual(effectTypes(plan.afterPersist), tableCase.after);
  });
}

test("planGoalTransition clear persists clear with full memory reset", () => {
  const goal = createThreadGoal("ship it");
  const plan = planGoalTransition(goal, { kind: "clear", source: "command" });

  assertDisjointPrimitivePlan(plan, "clear");
  assert.equal(plan.persist, "clear");
  assert.equal(plan.nextGoal, null);
  assert.deepEqual(effectTypes(plan.beforePersist), [
    "clearContinuation",
    "clearActiveAccounting",
    "resetRecovery",
  ]);
  assert.deepEqual(effectTypes(plan.afterPersist), ["stopStatusRefresh"]);
});

test("abort_pause derives paused goal from active current", () => {
  withUnixTime(100, () => {
    const goal = createThreadGoal("ship it");
    const plan = planGoalTransition(goal, { kind: "abort_pause" });

    assertDisjointPrimitivePlan(plan, "abort pause");
    assert.equal(plan.persist, "set");
    assert.equal(plan.nextGoal.status, "paused");
    assert.equal(plan.nextGoal.goalId, goal.goalId);
    assert.equal(plan.nextGoal.objective, goal.objective);
    assert.deepEqual(plan.nextGoal.usage, goal.usage);
    assert.equal(plan.nextGoal.createdAt, goal.createdAt);
    assert.equal(plan.nextGoal.updatedAt, 100);
    assert.deepEqual(effectTypes(plan.beforePersist), [
      "clearContinuation",
      "clearActiveAccounting",
      "resetRecovery",
    ]);
    assert.deepEqual(plan.afterPersist, []);
  });
});

test("resume_active derives active goal from paused or blocked current", () => {
  withUnixTime(100, () => {
    for (const status of ["paused", "blocked"] as const) {
      const current = { ...createThreadGoal("ship it"), status };
      const plan = planGoalTransition(current, { kind: "resume_active" });

      assertDisjointPrimitivePlan(plan, `resume ${status}`);
      assert.equal(plan.persist, "set");
      assert.equal(plan.nextGoal.status, "active");
      assert.equal(plan.nextGoal.goalId, current.goalId);
      assert.equal(plan.nextGoal.updatedAt, 100);
      assert.deepEqual(effectTypes(plan.beforePersist), ["clearContinuation", "resetRecovery"]);
      assert.deepEqual(plan.afterPersist, []);
    }
  });
});

test("blocked set transition stops continuation like paused", () => {
  const goal = createThreadGoal("ship it");
  const blocked = { ...cloneGoal(goal), status: "blocked" as const };
  const plan = planGoalTransition(goal, {
    kind: "set",
    nextGoal: blocked,
    source: "tool",
  });

  assertDisjointPrimitivePlan(plan, "blocked");
  assert.equal(plan.persist, "set");
  assert.deepEqual(effectTypes(plan.beforePersist), ["clearContinuation", "clearActiveAccounting"]);
  assert.deepEqual(plan.afterPersist, []);
});

test("runtime accounting defers persistence for active usage updates", () => {
  const goal = createThreadGoal("ship it");
  const next = {
    ...cloneGoal(goal),
    usage: { tokensUsed: 5, activeSeconds: 3 },
    updatedAt: goal.updatedAt + 1,
  };

  const plan = planGoalTransition(goal, {
    kind: "runtime_accounting",
    nextGoal: next,
  });

  assertDisjointPrimitivePlan(plan, "runtime defer");
  assert.equal(plan.persist, "defer");
  assert.deepEqual(effectTypes(plan.beforePersist), []);
  assert.deepEqual(plan.afterPersist, []);
});

function runtimeRequest(nextGoal: ThreadGoal) {
  return { kind: "runtime_accounting" as const, nextGoal };
}

test("runtime_accounting validates current and next goal shape", () => {
  const current = createThreadGoal("ship it");
  const next = {
    ...cloneGoal(current),
    usage: { tokensUsed: 1, activeSeconds: 0 },
    updatedAt: current.updatedAt + 1,
  };

  assert.throws(
    () => planGoalTransition(null, runtimeRequest(next)),
    /Invalid runtime_accounting transition: current goal is required/,
  );
  assert.throws(
    () => planGoalTransition(createThreadGoal("other"), runtimeRequest(next)),
    /Invalid runtime_accounting transition: goalId mismatch/,
  );
  assert.throws(
    () => planGoalTransition(current, runtimeRequest(current)),
    /runtime accounting must increase usage or change status/,
  );
  assert.throws(
    () => planGoalTransition(current, runtimeRequest({ ...next, objective: "mutated" })),
    /objective must be unchanged/,
  );
  assert.throws(
    () => planGoalTransition(current, runtimeRequest({ ...next, createdAt: current.createdAt + 1 })),
    /createdAt must be unchanged/,
  );
  assert.throws(
    () => planGoalTransition(current, runtimeRequest({ ...next, updatedAt: current.updatedAt - 1 })),
    /updatedAt must not decrease/,
  );
  assert.throws(
    () =>
      planGoalTransition(
        { ...current, usage: { tokensUsed: 5, activeSeconds: 2 } },
        runtimeRequest({ ...next, usage: { tokensUsed: 4, activeSeconds: 2 } }),
      ),
    /usage\.tokensUsed must not decrease/,
  );
});

test("runtime_accounting rejects inactive current and non-active next statuses", () => {
  const current = createThreadGoal("ship it");
  for (const status of ["paused", "blocked", "complete"] satisfies GoalStatus[]) {
    assert.throws(
      () =>
        planGoalTransition({ ...current, status }, runtimeRequest({
          ...cloneGoal(current),
          status: "active",
          usage: { tokensUsed: 1, activeSeconds: 0 },
          updatedAt: current.updatedAt + 1,
        })),
      /current status must be active/,
    );

    assert.throws(
      () =>
        planGoalTransition(current, runtimeRequest({
          ...cloneGoal(current),
          status,
          usage: { tokensUsed: 1, activeSeconds: 0 },
          updatedAt: current.updatedAt + 1,
        })),
      /next status must be active/,
    );
  }
});

test("applyGoalTransitionEffects invokes handlers in effect order", () => {
  const calls: string[] = [];
  applyGoalTransitionEffects(
    [
      { type: "clearContinuation" },
      { type: "clearActiveAccounting" },
      { type: "resetRecovery" },
    ],
    {
      clearContinuation: () => {
        calls.push("clearContinuation");
      },
      clearActiveAccounting: () => {
        calls.push("clearActiveAccounting");
      },
      resetRecovery: () => {
        calls.push("resetRecovery");
      },
      clearHostOverflowRecovery: () => {
        calls.push("clearHostOverflowRecovery");
      },
      setRecoveryPausedAttention: () => {
        calls.push("setRecoveryPausedAttention");
      },
      markContinuationQueued: (goalId) => {
        calls.push(`markContinuationQueued:${goalId}`);
      },
      stopStatusRefresh: () => {
        calls.push("stopStatusRefresh");
      },
    },
  );

  assert.deepEqual(calls, ["clearContinuation", "clearActiveAccounting", "resetRecovery"]);
});
