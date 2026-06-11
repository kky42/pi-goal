import assert from "node:assert/strict";
import { test } from "node:test";

import { toQueuedGoalContextCarrier, toQueuedGoalWorkSource } from "../src/queued-goal-messages.js";
import {
  applyQueuedGoalProviderContextRewrites,
  extensionQueuedGoalWorkMessageId,
  extensionQueuedGoalWorkMessageIdForRuntime,
} from "../src/queued-goal-work.js";
import { continuationGoalIdFromPrompt, continuationPrompt } from "../src/prompts.js";
import type { ThreadGoal } from "../src/types.js";
import { goalCustomContextMessage, goalUserContextMessage } from "./support/runtime-harness.js";

const activeGoal: ThreadGoal = {
  goalId: "goal-1",
  objective: "ship it",
  status: "active",
  tokenBudget: null,
  usage: { tokensUsed: 0, activeSeconds: 0 },
  createdAt: 0,
  updatedAt: 0,
};

const resolveStaleQueuedGoalWorkMessageId = (message: Parameters<typeof extensionQueuedGoalWorkMessageIdForRuntime>[0]) =>
  extensionQueuedGoalWorkMessageIdForRuntime(message, continuationGoalIdFromPrompt);

test("toQueuedGoalWorkSource ignores unrelated custom messages", () => {
  const unrelated = toQueuedGoalContextCarrier({
    role: "custom",
    customType: "other-extension",
    content: "ignored",
    timestamp: 1,
  });
  assert.ok(unrelated);
  assert.equal(toQueuedGoalWorkSource(unrelated), null);
});

test("applyQueuedGoalProviderContextRewrites does not mutate stale custom or user queued messages", () => {
  const completedGoal = { ...activeGoal, status: "complete" as const };
  const staleCustom = goalCustomContextMessage({
    content: "old",
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 1,
  });
  const staleUser = goalUserContextMessage(continuationPrompt(activeGoal), 2);

  const customResult = applyQueuedGoalProviderContextRewrites([staleCustom], {
    goal: completedGoal,
    resolveStaleQueuedGoalWorkMessageId,
    resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
  });

  assert.equal(customResult.changed, false);
  assert.deepEqual(customResult.messages[0], staleCustom);

  const userResult = applyQueuedGoalProviderContextRewrites([staleUser], {
    goal: completedGoal,
    resolveStaleQueuedGoalWorkMessageId,
    resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
  });

  assert.equal(userResult.changed, false);
  assert.deepEqual(userResult.messages[0], staleUser);
});

test("applyQueuedGoalProviderContextRewrites preserves historical active continuation content", () => {
  const older = goalCustomContextMessage({
    content: continuationPrompt(activeGoal),
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 1,
  });
  const latest = goalCustomContextMessage({
    content: continuationPrompt({
      ...activeGoal,
      usage: { tokensUsed: 99, activeSeconds: 42 },
    }),
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 2,
  });

  const { messages, changed } = applyQueuedGoalProviderContextRewrites([older, latest], {
    goal: activeGoal,
    resolveStaleQueuedGoalWorkMessageId,
    resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
  });

  assert.equal(changed, false);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], older);
  assert.deepEqual(messages[1], latest);
  assert.equal(messages[0]?.content, continuationPrompt(activeGoal));
  assert.equal(messages[1]?.content, continuationPrompt(activeGoal));
});

test("applyQueuedGoalProviderContextRewrites preserves stale continuation content for completed goals", () => {
  const staleContinuation = goalCustomContextMessage({
    content: continuationPrompt(activeGoal),
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 1,
  });

  const { messages, changed } = applyQueuedGoalProviderContextRewrites([staleContinuation], {
    goal: { ...activeGoal, status: "complete" },
    resolveStaleQueuedGoalWorkMessageId,
    resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
  });

  assert.equal(changed, false);
  assert.deepEqual(messages[0], staleContinuation);
});

test("applyQueuedGoalProviderContextRewrites leaves mixed active queued messages verbatim", () => {
  const userMarker = goalUserContextMessage(continuationPrompt(activeGoal), 2);
  const olderHidden = goalCustomContextMessage({
    content: continuationPrompt({
      ...activeGoal,
      usage: { tokensUsed: 1, activeSeconds: 1 },
    }),
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 1,
  });
  const latestHidden = goalCustomContextMessage({
    content: continuationPrompt(activeGoal),
    details: { kind: "continuation", goalId: activeGoal.goalId },
    timestamp: 3,
  });

  const { messages, changed } = applyQueuedGoalProviderContextRewrites(
    [olderHidden, userMarker, latestHidden],
    {
      goal: activeGoal,
      resolveStaleQueuedGoalWorkMessageId,
      resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
    },
  );

  assert.equal(changed, false);
  assert.deepEqual(messages[0], olderHidden);
  assert.deepEqual(messages[1]?.content, userMarker.content);
  assert.deepEqual(messages[2], latestHidden);
});
