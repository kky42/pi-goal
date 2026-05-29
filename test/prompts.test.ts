import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_TOOL_NAME_GUIDANCE,
  TOOL_PROMPT_GUIDELINES,
  budgetLimitPrompt,
  compactContinuationPrompt,
  continuationGoalIdFromPrompt,
  continuationPrompt,
  goalToolReference,
} from "../src/prompts.js";
import { createGoal } from "../src/state.js";

test("tool prompt guidelines include exposed and namespaced goal tool guidance", () => {
  assert.match(GOAL_TOOL_NAME_GUIDANCE, /available tool list/);
  assert.match(GOAL_TOOL_NAME_GUIDANCE, /pi__get_goal/);
  assert.match(GOAL_TOOL_NAME_GUIDANCE, /pi__create_goal/);
  assert.match(GOAL_TOOL_NAME_GUIDANCE, /pi__update_goal/);
  assert.match(GOAL_TOOL_NAME_GUIDANCE, /Do not assume display, history, or transcript tool names are callable/);

  assert.equal(goalToolReference("update_goal"), "update_goal (or the exposed namespaced equivalent, such as pi__update_goal)");

  const combined = TOOL_PROMPT_GUIDELINES.join("\n");
  assert.doesNotMatch(combined, /Use get_goal/);
  assert.match(combined, /create_goal \(or the exposed namespaced equivalent, such as pi__create_goal\)/);
  assert.match(combined, /update_goal \(or the exposed namespaced equivalent, such as pi__update_goal\)/);
});

test("continuation prompts do not expose goal ids or legacy runnable markers", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const compact = compactContinuationPrompt(created);
  const full = continuationPrompt(created);

  assert.equal(continuationGoalIdFromPrompt(compact), null);
  assert.equal(continuationGoalIdFromPrompt(full), null);
  assert.doesNotMatch(compact, /<pi_goal_continuation/);
  assert.doesNotMatch(full, /<pi_goal_continuation/);
  assert.doesNotMatch(compact, new RegExp(created.goalId));
  assert.doesNotMatch(full, new RegExp(created.goalId));
  assert.doesNotMatch(compact, /<objective>/);
  assert.match(full, /<objective>\nship it\n<\/objective>/);
  assert.match(compact, /Work on the active thread goal described by the current goal context/);
  assert.doesNotMatch(compact, /Call .*get_goal.*current status/);
  assert.doesNotMatch(full, /Call .*get_goal.*current status/);
  assert.doesNotMatch(compact, /get_goal/);
  assert.doesNotMatch(full, /get_goal/);
  assert.ok(compact.length < full.length);
});

test("legacy continuation parser remains backward-compatible only", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const legacy = `<pi_goal_continuation goal_id="${created.goalId}">\nlegacy\n</pi_goal_continuation>`;
  assert.equal(continuationGoalIdFromPrompt(legacy), created.goalId);
});

test("continuation and budget-limit prompts reference exposed goal-completion tool names", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const continuation = continuationPrompt(created);
  const budget = budgetLimitPrompt(created);

  for (const prompt of [continuation, budget]) {
    assert.match(prompt, /update_goal \(or the exposed namespaced equivalent, such as pi__update_goal\)/);
    assert.match(prompt, /pi__update_goal/);
    assert.doesNotMatch(prompt, /get_goal/);
    assert.doesNotMatch(prompt, /create_goal/);
    assert.match(prompt, /Do not assume display, history, or transcript tool names are callable/);
  }
});

test("continuation prompt uses Codex-style sections and safe current-goal guidance", () => {
  const created = createGoal(null, "ship it", 10).goal;
  assert.ok(created);

  const continuation = continuationPrompt(created);

  for (const section of [
    "Continuation behavior:",
    "Work from evidence:",
    "Progress visibility:",
    "Fidelity:",
    "Completion audit:",
    "Blocked audit:",
  ]) {
    assert.match(continuation, new RegExp(section));
  }
  assert.match(continuation, /<objective>\nship it\n<\/objective>/);
  assert.match(continuation, /If no active goal exists, do not continue/);
  assert.match(continuation, /Older goal-continuation messages are historical context/);
  assert.match(continuation, /Tokens used: 0/);
  assert.match(continuation, /Token budget: 10/);
  assert.match(continuation, /Tokens remaining: 10/);
  assert.doesNotMatch(continuation, /Time spent pursuing goal/);
});
