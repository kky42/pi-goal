import assert from "node:assert/strict";
import { test } from "node:test";

import { continuationPrompt } from "../src/prompts.js";
import {
  createRuntimeHarness,
  emitProviderContext,
  emitQueuedTurnThroughContext,
  goalCustomContextMessage,
  queuedCustomMessage,
} from "./support/runtime-harness.js";

test("provider context preserves active continuation messages byte-for-byte", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const goal = harness.snapshot().goal;
  assert.ok(goal);

  const olderContent = continuationPrompt({
    ...goal,
    usage: { tokensUsed: 1, activeSeconds: 1 },
  });
  const latestContent = continuationPrompt({
    ...goal,
    usage: { tokensUsed: 99, activeSeconds: 42 },
  });
  const messages = [
    goalCustomContextMessage({
      content: olderContent,
      details: { kind: "continuation", goalId: goal.goalId },
      timestamp: 1,
    }),
    goalCustomContextMessage({
      content: latestContent,
      details: { kind: "continuation", goalId: goal.goalId },
      timestamp: 2,
    }),
  ];

  const results = await emitProviderContext(harness, messages);

  assert.equal(results[0], undefined);
  assert.equal(messages[0]?.content, olderContent);
  assert.equal(messages[1]?.content, latestContent);
});

test("provider context preserves prior provider prefix across continuation turns", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const firstQueued = harness.sentMessages[0];
  assert.ok(firstQueued);
  const firstMessage = queuedCustomMessage(firstQueued, 1);
  const firstContent = String(firstMessage.content);
  harness.sentMessages.length = 0;

  await emitQueuedTurnThroughContext(harness, [firstMessage], 0);
  await harness.emit("agent_end", {
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        content: [],
        stopReason: "stop",
        usage: { input: 1, output: 1 },
      },
    ],
  });

  const secondQueued = harness.sentMessages[0];
  assert.ok(secondQueued);
  const secondMessage = queuedCustomMessage(secondQueued, 2);
  const secondContent = String(secondMessage.content);

  const results = await emitProviderContext(harness, [firstMessage, secondMessage]);

  assert.equal(results[0], undefined);
  assert.equal(firstMessage.content, firstContent);
  assert.equal(secondMessage.content, secondContent);
  assert.match(firstContent, /<objective>\nship it\n<\/objective>/);
  assert.match(secondContent, /<objective>\nship it\n<\/objective>/);
});
