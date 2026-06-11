import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { isGoalCustomEntry } from "../src/state.js";
import { CUSTOM_ENTRY_TYPE } from "../src/types.js";
import {
  assistantMessage,
  createRuntimeHarness,
  flushContinuationScheduler,
  queuedCustomMessage,
} from "./support/runtime-harness.js";

test("aborted turns pause goals and do not queue continuation", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("aborted", {
      input: 40,
      output: 2,
      cacheRead: 500,
      cacheWrite: 600,
      totalTokens: 1_142,
    }),
    toolResults: [],
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.status, "paused");
  assert.equal(goal?.usage.tokensUsed, 42);
  assert.equal(harness.sentMessages.length, 0);
});

test("a new user-driven agent start leaves a paused goal paused", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("aborted", { input: 8, output: 2 }),
    toolResults: [],
  });

  await harness.emit("before_agent_start", {
    type: "before_agent_start",
    prompt: "continue",
    systemPrompt: "",
    systemPromptOptions: {},
  });

  assert.equal(harness.snapshot().goal?.status, "paused");
  assert.equal(harness.snapshot().goal?.usage.tokensUsed, 10);
});

test("session resume prompt can reactivate a paused goal", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("aborted", { input: 8, output: 2 }),
    toolResults: [],
  });
  harness.sentMessages.length = 0;

  await harness.emit("session_start", { type: "session_start", reason: "resume" });

  assert.equal(harness.snapshot().goal?.status, "active");
  assert.equal(harness.sentUserMessages.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  const sentMessage = harness.sentMessages[0];
  assert.ok(sentMessage);
  assert.deepEqual(sentMessage.options, { triggerTurn: true, deliverAs: "followUp" });
  const content = sentMessage.message.content;
  if (typeof content !== "string") {
    assert.fail("Expected session resume to send a scheduler continuation prompt.");
  }
  assert.match(content, /<objective>\nship it\n<\/objective>/);
});

test("completed turns count input plus output and continue active goals", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const queued = harness.sentMessages[0];
  assert.ok(queued);
  const queuedMessage = queuedCustomMessage(queued);
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("message_start", {
    type: "message_start",
    message: queuedMessage,
  });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("stop", {
      input: 30,
      output: 12,
      cacheRead: 500,
      cacheWrite: 600,
      totalTokens: 1_142,
    }),
    toolResults: [],
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.status, "active");
  assert.equal(goal?.usage.tokensUsed, 42);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0]?.message.customType, CUSTOM_ENTRY_TYPE);
  assert.deepEqual(harness.sentMessages[0]?.message.details, {
    kind: "continuation",
    goalId: goal?.goalId,
  });
});

test("tool-use turn ends do not queue continuation before tool execution finishes", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("toolUse", { input: 10, output: 3 }),
    toolResults: [],
  });

  assert.equal(harness.snapshot().goal?.status, "active");
  assert.equal(harness.sentMessages.length, 0);
});

test("replacement during an in-flight turn does not charge old tokens to the new goal", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("old goal");
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.runCommand("new goal");
  const replacement = harness.snapshot().goal;
  assert.equal(replacement?.objective, "new goal");

  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("stop", { input: 80, output: 20 }),
    toolResults: [],
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.goalId, replacement?.goalId);
  assert.equal(goal?.usage.tokensUsed, 0);
  assert.equal(harness.sentMessages.length, 1);
});

test("update_goal returns simplified response details", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  harness.sentMessages.length = 0;

  const blocked = (await harness.runTool("update_goal", { status: "blocked" })) as {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
  };
  const blockedGoal = blocked.details.goal as Record<string, unknown>;
  assert.equal(blockedGoal.objective, "ship it");
  assert.equal(blockedGoal.status, "blocked");
  assert.equal(blockedGoal.timeUsed, "0s");
  assert.deepEqual(JSON.parse(blocked.content[0]?.text ?? ""), {
    goal: blocked.details.goal,
  });

  await harness.runCommand("resume");
  const completed = (await harness.runTool("update_goal", { status: "complete" })) as {
    details: Record<string, unknown>;
  };
  assert.equal((completed.details.goal as { status?: string }).status, "complete");
});

test("agent end waits for idle before continuing active goals", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createRuntimeHarness();
    await harness.runCommand("ship it");
    const queued = harness.sentMessages[0];
    assert.ok(queued);
    const queuedMessage = queuedCustomMessage(queued);
    harness.sentMessages.length = 0;
    harness.setIdle(false);

    await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
    await harness.emit("message_start", {
      type: "message_start",
      message: queuedMessage,
    });
    await harness.emit("agent_end", {
      type: "agent_end",
      messages: [assistantMessage("stop", { input: 30, output: 12 })],
    });

    assert.equal(harness.sentMessages.length, 0);
    harness.setIdle(true);
    harness.setPendingMessages(false);
    flushContinuationScheduler();

    const goal = harness.snapshot().goal;
    assert.equal(goal?.status, "active");
    assert.equal(harness.sentMessages.length, 1);
    assert.deepEqual(harness.sentMessages[0]?.message.details, {
      kind: "continuation",
      goalId: goal?.goalId,
    });
  } finally {
    mock.timers.reset();
  }
});

test("agent end does not queue continuation while user messages are pending", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createRuntimeHarness();
    await harness.runCommand("ship it");
    const queued = harness.sentMessages[0];
    assert.ok(queued);
    const queuedMessage = queuedCustomMessage(queued);
    harness.sentMessages.length = 0;
    harness.setPendingMessages(true);

    await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
    await harness.emit("message_start", {
      type: "message_start",
      message: queuedMessage,
    });
    await harness.emit("agent_end", {
      type: "agent_end",
      messages: [assistantMessage("stop", { input: 30, output: 12 })],
    });

    assert.equal(harness.sentMessages.length, 0);
    harness.setPendingMessages(false);
    flushContinuationScheduler();
    assert.equal(harness.sentMessages.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("completing a goal cancels a scheduled continuation before it is sent", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createRuntimeHarness({ idle: false, pendingMessages: false });
    await harness.runCommand("ship it");
    harness.sentMessages.length = 0;

    await harness.emit("agent_end", {
      type: "agent_end",
      messages: [assistantMessage("stop", { input: 30, output: 12 })],
    });
    assert.equal(harness.sentMessages.length, 0);

    await harness.runTool("update_goal", { status: "complete" });
    const completeSetEntries = harness.entries.filter((entry) => {
      return (
        entry.type === "custom" &&
        entry.customType === CUSTOM_ENTRY_TYPE &&
        isGoalCustomEntry(entry.data) &&
        entry.data.kind === "set" &&
        entry.data.goal.status === "complete"
      );
    });
    assert.equal(completeSetEntries.length, 1);
    harness.setIdle(true);
    harness.setPendingMessages(false);
    flushContinuationScheduler();

    assert.equal(harness.snapshot().goal?.status, "complete");
    assert.equal(harness.sentMessages.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("goal follow-up guard resets when custom-message continuations start", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const queued = harness.sentMessages[0];
  assert.ok(queued);
  const queuedMessage = {
    role: "custom",
    customType: CUSTOM_ENTRY_TYPE,
    content: queued.message.content,
    display: false,
    details: queued.message.details,
    timestamp: 1,
  };
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 2 });
  await harness.emit("message_start", {
    type: "message_start",
    message: queuedMessage,
  });
  assert.equal(harness.abortCount, 0);
  await harness.emit("agent_end", {
    type: "agent_end",
    messages: [assistantMessage("stop", { input: 5, output: 6 })],
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.status, "active");
  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(harness.sentMessages[0]?.message.details, {
    kind: "continuation",
    goalId: goal?.goalId,
  });
});

test("auto-queued continuations use the Codex-style objective prompt without visible goal id", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const commandStart = harness.sentMessages[0];
  assert.ok(commandStart);
  const startPrompt = String(commandStart.message.content);
  assert.match(startPrompt, /<objective>\nship it\n<\/objective>/);

  harness.sentMessages.length = 0;
  await harness.emit("before_agent_start", {
    type: "before_agent_start",
    prompt: startPrompt,
    systemPrompt: "",
    systemPromptOptions: {},
  });
  await harness.emit("agent_end", {
    type: "agent_end",
    messages: [assistantMessage("stop", { input: 1, output: 1 })],
  });

  const continuation = harness.sentMessages[0];
  assert.ok(continuation);
  const content = String(continuation.message.content);
  assert.match(content, /<objective>\nship it\n<\/objective>/);
  assert.doesNotMatch(content, new RegExp(String(harness.snapshot().goal?.goalId)));
  assert.doesNotMatch(content, /get_goal/);
  assert.doesNotMatch(content, /create_goal/);
  assert.match(content, /update_goal/);
});

test("session compaction queues continuation for active goals after length stops", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const queued = harness.sentMessages[0];
  assert.ok(queued);
  const queuedMessage = queuedCustomMessage(queued);
  harness.sentMessages.length = 0;
  harness.setIdle(false);

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("message_start", {
    type: "message_start",
    message: queuedMessage,
  });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("length", { input: 30, output: 12 }),
    toolResults: [],
  });
  assert.equal(harness.sentMessages.length, 0);

  harness.setIdle(true);
  harness.setPendingMessages(false);
  await harness.emit("session_compact", {
    type: "session_compact",
    summary: "compact summary",
    tokensBefore: 100,
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.status, "active");
  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(harness.sentMessages[0]?.message.details, {
    kind: "continuation",
    goalId: goal?.goalId,
  });
});

test("assistant error turns do not immediately queue continuation", async () => {
  const harness = createRuntimeHarness();
  await harness.runCommand("ship it");
  const queued = harness.sentMessages[0];
  assert.ok(queued);
  const queuedMessage = queuedCustomMessage(queued);
  harness.sentMessages.length = 0;

  await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 });
  await harness.emit("message_start", {
    type: "message_start",
    message: queuedMessage,
  });
  await harness.emit("turn_end", {
    type: "turn_end",
    turnIndex: 0,
    message: assistantMessage("error", { input: 30, output: 12 }, "websocket closed"),
    toolResults: [],
  });

  const goal = harness.snapshot().goal;
  assert.equal(goal?.status, "active");
  assert.equal(goal?.usage.tokensUsed, 42);
  assert.equal(harness.sentMessages.length, 0);
});
