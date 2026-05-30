import assert from "node:assert/strict";
import test from "node:test";

import {
  handleGoalCommand,
  registerGoalCommand,
  type CommandHost,
  type GoalCommandContext,
  type GoalCommandPi,
} from "../src/commands.js";
import { applyUsage, updateGoalStatus } from "../src/state.js";
import type { GoalEntrySource, ThreadGoal } from "../src/types.js";

function createHarness() {
  let goal: ThreadGoal | null = null;
  let continuationRequests = 0;
  let waitForIdleCalls = 0;
  let continuationRequestResult = false;
  let onWaitForIdle: (() => void | Promise<void>) | null = null;
  const notifications: string[] = [];

  const pi: GoalCommandPi = {
    registerCommand() {},
  };

  const host: CommandHost = {
    getGoal: () => goal,
    setGoal(nextGoal: ThreadGoal, _source: GoalEntrySource) {
      goal = nextGoal;
    },
    clearGoal() {
      goal = null;
    },
    requestContinuation() {
      continuationRequests += 1;
      return continuationRequestResult;
    },
  };

  const ctx: GoalCommandContext = {
    hasUI: true,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      confirm: async () => true,
      setStatus: () => {},
    },
    waitForIdle: async () => {
      waitForIdleCalls += 1;
      await onWaitForIdle?.();
    },
  };

  return {
    ctx,
    host,
    pi,
    setGoal(nextGoal: ThreadGoal | null) {
      goal = nextGoal;
    },
    get goal() {
      return goal;
    },
    notifications,
    resetContinuationRequests() {
      continuationRequests = 0;
    },
    resetWaitForIdleCalls() {
      waitForIdleCalls = 0;
    },
    setContinuationRequestResult(result: boolean) {
      continuationRequestResult = result;
    },
    setWaitForIdle(handler: (() => void | Promise<void>) | null) {
      onWaitForIdle = handler;
    },
    get continuationRequests() {
      return continuationRequests;
    },
    get waitForIdleCalls() {
      return waitForIdleCalls;
    },
  };
}

test("/goal does not autocomplete subcommands for free-form objectives", () => {
  const harness = createHarness();
  const captured: {
    getArgumentCompletions: ((argumentPrefix: string) => unknown) | null;
  } = { getArgumentCompletions: null };
  const pi: GoalCommandPi = {
    registerCommand(_name, options) {
      captured.getArgumentCompletions = options.getArgumentCompletions ?? null;
    },
  };

  registerGoalCommand(pi, harness.host);

  const getArgumentCompletions = captured.getArgumentCompletions;
  assert.ok(getArgumentCompletions);
  assert.equal(getArgumentCompletions(""), null);
  assert.equal(getArgumentCompletions("count from 1 to 5"), null);
  assert.deepEqual(getArgumentCompletions("p"), [
    {
      value: "pause",
      label: "pause",
      description: "goal pause",
    },
  ]);
});

test("/goal objective creates the goal and requests scheduler continuation", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);

  assert.equal(harness.goal?.objective, "ship the feature");
  const notification = harness.notifications.at(-1);
  assert.ok(notification);
  const [banner, ...summaryLines] = notification.split("\n");
  assert.equal(banner, "\x1b[38;5;220mGoal set.\x1b[39m");
  assert.equal(
    summaryLines.join("\n"),
    [
      "Status: active",
      "Objective: ship the feature",
      "Time used: 0s",
      "Tokens used: 0",
      "Hint: /goal pause, /goal clear",
    ].join("\n"),
  );
  assert.equal(harness.continuationRequests, 1);
});

test("/goal resume requests scheduler continuation", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const paused = updateGoalStatus(harness.goal, "paused").goal;
  assert.ok(paused);
  harness.resetContinuationRequests();
  harness.setGoal(paused);

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);

  assert.equal(harness.goal?.status, "active");
  assert.equal(harness.continuationRequests, 1);
});

test("/goal resume waits for scheduled continuation in headless mode", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const paused = updateGoalStatus(harness.goal, "paused").goal;
  assert.ok(paused);
  harness.resetContinuationRequests();
  harness.resetWaitForIdleCalls();
  harness.setGoal(paused);
  harness.ctx.hasUI = false;
  harness.setWaitForIdle(() => {
    const completed = updateGoalStatus(harness.goal, "complete").goal;
    assert.ok(completed);
    harness.setGoal(completed);
  });

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);

  assert.equal(harness.goal?.status, "complete");
  assert.equal(harness.continuationRequests, 1);
  assert.equal(harness.waitForIdleCalls, 1);
});

test("/goal objective always uses the scheduler-owned continuation path", async () => {
  const harness = createHarness();
  const host: CommandHost = {
    getGoal: () => harness.goal,
    setGoal(nextGoal: ThreadGoal) {
      harness.setGoal(nextGoal);
    },
    clearGoal() {
      harness.setGoal(null);
    },
    requestContinuation: harness.host.requestContinuation,
  };

  await handleGoalCommand(harness.pi, host, "ship the feature", harness.ctx);

  assert.equal(harness.goal?.objective, "ship the feature");
  assert.equal(harness.continuationRequests, 1);

  harness.resetContinuationRequests();
  await handleGoalCommand(harness.pi, host, "another objective", harness.ctx);
  assert.equal(harness.continuationRequests, 1);
});

test("/goal pause rejects completed and paused goals", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const completed = updateGoalStatus(harness.goal, "complete").goal;
  assert.ok(completed);
  harness.setGoal(completed);

  await handleGoalCommand(harness.pi, harness.host, "pause", harness.ctx);
  assert.equal(harness.goal?.status, "complete");
  assert.match(harness.notifications.at(-1) ?? "", /Completed goals are terminal/);

  const paused = updateGoalStatus(completed, "paused");
  assert.equal(paused.ok, false);
});

test("/goal resume rejects completed and active goals", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const completed = updateGoalStatus(harness.goal, "complete").goal;
  assert.ok(completed);
  harness.setGoal(completed);

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);
  assert.equal(harness.goal?.status, "complete");
  assert.match(harness.notifications.at(-1) ?? "", /Completed goals are terminal/);

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  assert.equal(harness.goal?.status, "active");
  harness.resetContinuationRequests();

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);
  assert.equal(harness.goal?.status, "active");
  assert.match(harness.notifications.at(-1) ?? "", /Only paused or blocked goals can be resumed/);
  assert.equal(harness.continuationRequests, 0);
});

test("/goal objective replaces a completed goal without confirmation", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "old objective", harness.ctx);
  const completed = updateGoalStatus(harness.goal, "complete").goal;
  assert.ok(completed);
  harness.setGoal(completed);
  harness.resetContinuationRequests();

  await handleGoalCommand(harness.pi, harness.host, "new objective", harness.ctx);

  assert.equal(harness.goal?.objective, "new objective");
  assert.equal(harness.goal?.status, "active");
  assert.notEqual(harness.goal?.goalId, completed.goalId);
  assert.equal(harness.continuationRequests, 1);
});

test("/goal objective replaces non-complete goals in headless mode and waits for continuation", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "old objective", harness.ctx);
  const previousGoalId = harness.goal?.goalId;
  assert.ok(previousGoalId);
  harness.resetContinuationRequests();
  harness.resetWaitForIdleCalls();
  harness.ctx.hasUI = false;
  harness.setWaitForIdle(() => {
    const completed = updateGoalStatus(harness.goal, "complete").goal;
    assert.ok(completed);
    harness.setGoal(completed);
  });

  await handleGoalCommand(harness.pi, harness.host, "new objective", harness.ctx);

  assert.equal(harness.goal?.objective, "new objective");
  assert.equal(harness.goal?.status, "complete");
  assert.notEqual(harness.goal?.goalId, previousGoalId);
  assert.equal(harness.continuationRequests, 1);
  assert.equal(harness.waitForIdleCalls, 1);
});

test("/goal objective drains scheduled headless continuations until the goal is terminal", async () => {
  const harness = createHarness();
  harness.ctx.hasUI = false;
  harness.setContinuationRequestResult(true);
  harness.setWaitForIdle(() => {
    if (harness.waitForIdleCalls !== 3) {
      return;
    }
    const completed = updateGoalStatus(harness.goal, "complete").goal;
    assert.ok(completed);
    harness.setGoal(completed);
  });

  await handleGoalCommand(harness.pi, harness.host, "count to 3", harness.ctx);

  assert.equal(harness.goal?.status, "complete");
  assert.equal(harness.continuationRequests, 3);
  assert.equal(harness.waitForIdleCalls, 3);
});

test("/goal resume does not restart an over-budget budget-limited goal", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const budgeted = { ...harness.goal, tokenBudget: 10 } as ThreadGoal;
  const limited = applyUsage(budgeted, 10, 0).goal;
  assert.ok(limited);
  harness.resetContinuationRequests();
  harness.setGoal(limited);

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);

  assert.equal(harness.goal?.status, "budgetLimited");
  assert.equal(harness.continuationRequests, 0);
  assert.match(harness.notifications.at(-1) ?? "", /Budget-limited goals are system-controlled/);
});

test("/goal resume works from blocked goals", async () => {
  const harness = createHarness();

  await handleGoalCommand(harness.pi, harness.host, "ship the feature", harness.ctx);
  const blocked = updateGoalStatus(harness.goal, "blocked").goal;
  assert.ok(blocked);
  harness.setGoal(blocked);
  harness.resetContinuationRequests();

  await handleGoalCommand(harness.pi, harness.host, "resume", harness.ctx);

  assert.equal(harness.goal?.status, "active");
  assert.equal(harness.continuationRequests, 1);
});
