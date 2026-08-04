import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  assistantMessage,
  createRuntimeHarness,
  flushContinuationScheduler,
} from "./support/runtime-harness.js";

const CHANNEL = "pi-flow:task-state";

function taskState(
  task_id: string,
  status: "accepted" | "completed" | "failed",
  task_type: "agent" | "workflow" = "agent",
) {
  return { version: 1, task_id, task_type, status } as const;
}

async function emitAgentEnd(harness: ReturnType<typeof createRuntimeHarness>): Promise<void> {
  await harness.emit("agent_end", {
    type: "agent_end",
    messages: [assistantMessage("stop", { input: 1, output: 1 })],
  });
}

test("accepted pi-flow tasks block continuation and cancel a scheduled retry", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const harness = createRuntimeHarness({ idle: false });
    await harness.runCommand("ship it");
    assert.equal(harness.sentMessages.length, 0);

    harness.emitPiEvent(CHANNEL, taskState("task-1", "accepted"));
    harness.setIdle(true);
    flushContinuationScheduler();
    await emitAgentEnd(harness);
    assert.equal(harness.sentMessages.length, 0);

    harness.emitPiEvent(CHANNEL, taskState("task-1", "completed"));
    assert.equal(harness.sentMessages.length, 0);
    await emitAgentEnd(harness);
    assert.equal(harness.sentMessages.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("all accepted pi-flow tasks must terminate before continuation unblocks", async () => {
  const harness = createRuntimeHarness();
  harness.emitPiEvent(CHANNEL, taskState("agent-1", "accepted"));
  harness.emitPiEvent(CHANNEL, taskState("workflow-1", "accepted", "workflow"));
  await harness.runCommand("ship it");

  harness.emitPiEvent(CHANNEL, taskState("agent-1", "completed"));
  await emitAgentEnd(harness);
  assert.equal(harness.sentMessages.length, 0);

  harness.emitPiEvent(CHANNEL, taskState("workflow-1", "failed", "workflow"));
  assert.equal(harness.sentMessages.length, 0);
  await emitAgentEnd(harness);
  assert.equal(harness.sentMessages.length, 1);
});

test("malformed pi-flow task events are ignored", async () => {
  const malformedEvents: unknown[] = [
    null,
    [],
    { version: 2, task_id: "task-1", task_type: "agent", status: "accepted" },
    { version: 1, task_id: 1, task_type: "agent", status: "accepted" },
    { version: 1, task_id: "task-1", task_type: "other", status: "accepted" },
    { version: 1, task_id: "task-1", task_type: "agent", status: "running" },
    { version: 1, task_id: "task-1", task_type: "agent" },
    { ...taskState("task-1", "accepted"), extra: true },
  ];

  for (const malformedEvent of malformedEvents) {
    const harness = createRuntimeHarness();
    harness.emitPiEvent(CHANNEL, malformedEvent);
    await harness.runCommand("ship it");
    assert.equal(harness.sentMessages.length, 1);
  }
});

test("session start clears pending pi-flow tasks", async () => {
  const harness = createRuntimeHarness();
  harness.emitPiEvent(CHANNEL, taskState("task-1", "accepted"));
  await harness.runCommand("ship it");
  assert.equal(harness.sentMessages.length, 0);

  await harness.emit("session_start", { type: "session_start", reason: "startup" });
  assert.equal(harness.sentMessages.length, 1);
});

test("session shutdown clears pending pi-flow tasks", async () => {
  const harness = createRuntimeHarness();
  harness.emitPiEvent(CHANNEL, taskState("task-1", "accepted"));
  await harness.runCommand("ship it");
  assert.equal(harness.sentMessages.length, 0);

  await harness.emit("session_shutdown", { type: "session_shutdown" });
  harness.emitPiEvent(CHANNEL, taskState("late-task", "accepted"));
  await emitAgentEnd(harness);
  assert.equal(harness.sentMessages.length, 1);
});
