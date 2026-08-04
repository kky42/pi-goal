import assert from "node:assert/strict";
import { test } from "node:test";

import { extensionQueuedGoalWorkMessageId } from "../src/queued-goal-work.js";
import { CUSTOM_ENTRY_TYPE } from "../src/types.js";

test("extensionQueuedGoalWorkMessageId reads active goal metadata only", () => {
  assert.equal(
    extensionQueuedGoalWorkMessageId({
      role: "custom",
      customType: CUSTOM_ENTRY_TYPE,
      details: { kind: "continuation", goalId: "goal-1" },
    }),
    "goal-1",
  );
  assert.equal(
    extensionQueuedGoalWorkMessageId({
      role: "custom",
      customType: CUSTOM_ENTRY_TYPE,
      details: { kind: "other", goalId: "goal-1" },
    }),
    null,
  );
  assert.equal(
    extensionQueuedGoalWorkMessageId({
      role: "user",
      content: [{ type: "text", text: "<goal>not metadata</goal>" }],
    }),
    null,
  );
});
