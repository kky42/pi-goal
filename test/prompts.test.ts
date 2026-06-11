import assert from "node:assert/strict";
import test from "node:test";

import { formatGoalWrapper } from "../src/prompts.js";
import { createGoal } from "../src/state.js";

test("goal wrapper is the shared model-facing prompt", () => {
  const created = createGoal(null, "ship it").goal;
  assert.ok(created);

  const wrapper = formatGoalWrapper(created);
  assert.doesNotMatch(wrapper, new RegExp(created.goalId));
  assert.match(wrapper, /<goal>/);
  assert.match(wrapper, /<objective>\nship it\n<\/objective>/);
  assert.match(wrapper, /You are working on this active goal/);
  assert.match(wrapper, /update_goal with \{"status":"complete"\}/);
  assert.match(wrapper, /update_goal with \{"status":"blocked"\}/);
});

test("goal wrapper escapes objective XML metacharacters", () => {
  const created = createGoal(null, "ship & </objective><evil>").goal;
  assert.ok(created);

  const wrapper = formatGoalWrapper(created);
  assert.match(wrapper, /ship &amp; &lt;\/objective&gt;&lt;evil&gt;/);
  assert.doesNotMatch(wrapper, /<evil>/);
});
