import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createGoalRuntimeStatus, type StatusContext } from "../src/goal-runtime-status.js";
import type { ThreadGoal } from "../src/types.js";

function activeGoal(activeSeconds: number, status: ThreadGoal["status"] = "active"): ThreadGoal {
  return {
    goalId: "goal-1",
    objective: "ship it",
    status,
    usage: { tokensUsed: 0, activeSeconds },
    createdAt: 0,
    updatedAt: 0,
  };
}

test("active footer refresh uses one 1s interval and stops when inactive", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const footerStatuses: Array<string | undefined> = [];
    let activeSeconds = 0;
    let goalStatus: ThreadGoal["status"] | null = "active";

    const runtimeStatus = createGoalRuntimeStatus({
      getGoalForDisplay: () => (goalStatus ? activeGoal(activeSeconds, goalStatus) : null),
      getGoalStatus: () => goalStatus,
      getRecoveryAttention: () => null,
    });
    const ctx: StatusContext = {
      ui: {
        setStatus(_key, status) {
          footerStatuses.push(status);
        },
      },
    };

    runtimeStatus.refreshUi(ctx);
    runtimeStatus.refreshUi(ctx);
    runtimeStatus.refreshUi(ctx);
    assert.equal(footerStatuses.length, 3);

    activeSeconds = 1;
    mock.timers.tick(999);
    assert.equal(footerStatuses.length, 3);

    mock.timers.tick(1);
    assert.deepEqual(footerStatuses, [
      "Pursuing goal",
      "Pursuing goal",
      "Pursuing goal",
      "Pursuing goal (1s)",
    ]);

    activeSeconds = 2;
    mock.timers.tick(1_000);
    assert.equal(footerStatuses.length, 5);
    assert.equal(footerStatuses.at(-1), "Pursuing goal (2s)");

    goalStatus = "paused";
    mock.timers.tick(1_000);
    assert.equal(footerStatuses.length, 5);

    activeSeconds = 99;
    mock.timers.tick(5_000);
    assert.equal(footerStatuses.length, 5);

    runtimeStatus.stopStatusRefresh();
  } finally {
    mock.timers.reset();
  }
});
