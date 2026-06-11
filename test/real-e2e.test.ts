import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const REAL_E2E_ENABLED = process.env.PI_GOAL_REAL_E2E === "1";
const MODEL = "deepseek/deepseek-v4-flash";
const THINKING = "high";
const EXTENSION_PATH = path.resolve("src/index.ts");
const CUSTOM_ENTRY_TYPE = "pi-codex-goal";

type JsonObject = Record<string, unknown>;

interface RpcResponse extends JsonObject {
  type: "response";
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RpcSession {
  events: JsonObject[];
  responses: RpcResponse[];
  sessionDir: string;
  send(command: JsonObject): Promise<RpcResponse>;
  waitFor<T extends JsonObject>(
    label: string,
    predicate: (event: JsonObject) => event is T,
    timeoutMs?: number,
  ): Promise<T>;
  close(): Promise<void>;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!isObject(part) || part.type !== "text" || typeof part.text !== "string") {
        return "";
      }
      return part.text;
    })
    .join("");
}

function textFromMessage(message: unknown): string {
  if (!isObject(message)) {
    return "";
  }
  return textFromContent(message.content);
}

function assistantText(event: JsonObject): string | null {
  if (event.type !== "message_end" || !isObject(event.message)) {
    return null;
  }
  if (event.message.role !== "assistant") {
    return null;
  }
  const text = textFromMessage(event.message).trim();
  return text.length > 0 ? text : null;
}

function goalWorkMessages(messages: unknown): JsonObject[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter((message): message is JsonObject => {
    if (!isObject(message) || message.role !== "custom" || message.customType !== CUSTOM_ENTRY_TYPE) {
      return false;
    }
    const details = message.details;
    return (
      isObject(details) &&
      (details.kind === "command_start" || details.kind === "command_resume" || details.kind === "continuation") &&
      typeof details.goalId === "string"
    );
  });
}

async function readSessionEntries(sessionFile: string): Promise<JsonObject[]> {
  const content = await readFile(sessionFile, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonObject);
}

async function findSessionFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(fullPath);
      }
    }
  }
  await walk(root);
  return found.sort();
}

async function runProcess(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));

  const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30_000);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(timeout));

  const result = { stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), code };
  if (!options.allowFailure && code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${code}\n${result.stderr}`);
  }
  return result;
}

function sessionMessages(entries: JsonObject[]): JsonObject[] {
  return entries
    .map((entry) => {
      if (entry.type === "message") {
        return entry.message;
      }
      if (entry.type === "custom_message") {
        return {
          role: "custom",
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
          details: entry.details,
        };
      }
      return null;
    })
    .filter((message): message is JsonObject => isObject(message));
}

async function spawnRpcSession(): Promise<RpcSession> {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "pi-goal-real-e2e-"));
  const child = spawn(
    "pi",
    [
      "--mode",
      "rpc",
      "--model",
      MODEL,
      "--thinking",
      THINKING,
      "--session-dir",
      path.join(sessionDir, "sessions"),
      "--no-extensions",
      "--extension",
      EXTENSION_PATH,
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-builtin-tools",
    ],
    {
      cwd: path.resolve("."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  child.stdin.setDefaultEncoding("utf8");

  return createRpcSession(child, sessionDir);
}

function createRpcSession(child: ChildProcessWithoutNullStreams, sessionDir: string): RpcSession {
  const emitter = new EventEmitter();
  const events: JsonObject[] = [];
  const responses: RpcResponse[] = [];
  const pendingResponses = new Map<string, (response: RpcResponse) => void>();
  const stderrChunks: string[] = [];
  let stdoutBuffer = "";
  let nextId = 0;
  let closed = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf("\n");
      if (line.length === 0) {
        continue;
      }
      const parsed = JSON.parse(line) as JsonObject;
      if (parsed.type === "response") {
        const response = parsed as RpcResponse;
        responses.push(response);
        if (typeof response.id === "string") {
          pendingResponses.get(response.id)?.(response);
          pendingResponses.delete(response.id);
        }
      } else {
        events.push(parsed);
        emitter.emit("event", parsed);
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  child.on("exit", () => {
    closed = true;
    emitter.emit("exit");
  });

  const sendRaw = (command: JsonObject): void => {
    child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  const send = (command: JsonObject): Promise<RpcResponse> => {
    if (closed) {
      throw new Error(`RPC process already exited. stderr:\n${stderrChunks.join("")}`);
    }
    const id = typeof command.id === "string" ? command.id : `req-${++nextId}`;
    const commandWithId = { ...command, id };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingResponses.delete(id);
        reject(new Error(`Timed out waiting for ${String(command.type)} response. stderr:\n${stderrChunks.join("")}`));
      }, 30_000);
      pendingResponses.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      sendRaw(commandWithId);
    });
  };

  const waitFor: RpcSession["waitFor"] = (label, predicate, timeoutMs = 120_000) => {
    for (const event of events) {
      if (predicate(event)) {
        return Promise.resolve(event);
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        emitter.off("event", onEvent);
        reject(new Error(`Timed out waiting for ${label}. stderr:\n${stderrChunks.join("")}`));
      }, timeoutMs);
      const onEvent = (event: JsonObject) => {
        if (!predicate(event)) {
          return;
        }
        clearTimeout(timeout);
        emitter.off("event", onEvent);
        resolve(event);
      };
      emitter.on("event", onEvent);
    });
  };

  const close = async (): Promise<void> => {
    if (!closed) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await rm(sessionDir, { recursive: true, force: true });
  };

  return { events, responses, sessionDir, send, waitFor, close };
}

test(
  "real pi RPC goal continuation lets queued user input win, then resumes the count",
  { skip: REAL_E2E_ENABLED ? false : "set PI_GOAL_REAL_E2E=1 to run provider-backed pi e2e", timeout: 240_000 },
  async () => {
    const rpc = await spawnRpcSession();
    try {
      const stateResponse = await rpc.send({ type: "get_state" });
      assert.equal(stateResponse.success, true, stateResponse.error);
      const state = stateResponse.data;
      assert.ok(isObject(state));
      assert.ok(isObject(state.model));
      assert.equal(state.model.provider, "deepseek");
      assert.equal(state.model.id, "deepseek-v4-flash");
      assert.equal(state.thinkingLevel, THINKING);
      if (typeof state.sessionFile !== "string") {
        assert.fail("Expected RPC state to include a sessionFile path.");
      }
      const sessionFile = state.sessionFile;

      const queuedUserResponse: { promise: Promise<RpcResponse> | null } = { promise: null };

      const firstNumberSeen = rpc.waitFor(
        "assistant replying 1",
        (event): event is JsonObject => {
          const text = assistantText(event);
          if (text === null) {
            return false;
          }
          if (!/^1\b/.test(text)) {
            return false;
          }
          if (!queuedUserResponse.promise) {
            queuedUserResponse.promise = rpc.send({
              type: "prompt",
              message:
                "Queued user message for ordering test. Reply exactly USER-QUEUE-CONSUMED in this turn. Do not call update_goal. After this turn, continue the active counting goal from the next number.",
              streamingBehavior: "followUp",
            });
          }
          return true;
        },
        90_000,
      );

      const goalResponse = await rpc.send({
        type: "prompt",
        message:
          "/goal Count visibly from 1 to 10. Each assistant turn must contain exactly one visible number, starting with 1 and increasing by 1. Do not combine numbers. After emitting a number less than 10, stop. When you have emitted 10, call update_goal with status \"complete\".",
      });
      assert.equal(goalResponse.success, true, goalResponse.error);

      await firstNumberSeen;
      assert.ok(
        queuedUserResponse.promise,
        "queued user message should be sent while the first continuation is still running",
      );
      const queuedResponse = await queuedUserResponse.promise;
      assert.equal(queuedResponse.success, true, queuedResponse.error);

      await rpc.waitFor(
        "queued user message response",
        (event): event is JsonObject => assistantText(event)?.includes("USER-QUEUE-CONSUMED") === true,
        90_000,
      );

      await rpc.waitFor(
        "goal continuation after queued user input",
        (event): event is JsonObject => /\b2\b/.test(assistantText(event) ?? ""),
        90_000,
      );

      await rpc.waitFor(
        "goal completion tool result",
        (event): event is JsonObject => {
          if (event.type !== "tool_execution_end" || event.toolName !== "update_goal" || event.isError !== false) {
            return false;
          }
          const result = event.result;
          if (!isObject(result) || !isObject(result.details) || !isObject(result.details.goal)) {
            return false;
          }
          return result.details.goal.status === "complete";
        },
        180_000,
      );

      const messagesResponse = await rpc.send({ type: "get_messages" });
      assert.equal(messagesResponse.success, true, messagesResponse.error);
      assert.ok(isObject(messagesResponse.data));
      const providerMessages = messagesResponse.data.messages;
      const continuations = goalWorkMessages(providerMessages);
      assert.ok(continuations.length >= 2, "expected at least the initial and post-user goal messages");

      const firstContinuation = continuations[0];
      assert.ok(firstContinuation);
      assert.equal(typeof firstContinuation.content, "string");
      assert.ok(isObject(firstContinuation.details));
      assert.equal(firstContinuation.details.kind, "command_start");
      const firstContinuationGoalId = firstContinuation.details.goalId;
      if (typeof firstContinuationGoalId !== "string") {
        assert.fail("Expected continuation details to include a hidden goalId.");
      }
      const firstContinuationContent = firstContinuation.content as string;
      assert.doesNotMatch(firstContinuationContent, new RegExp(firstContinuationGoalId));

      const userMessageIndex = (providerMessages as JsonObject[]).findIndex((message) => {
        return isObject(message) && message.role === "user" && textFromMessage(message).includes("USER-QUEUE-CONSUMED");
      });
      assert.notEqual(userMessageIndex, -1, "queued user message should be persisted");
      const continuationIndexes = (providerMessages as JsonObject[])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => goalWorkMessages([message]).length === 1)
        .map(({ index }) => index);
      assert.ok(continuationIndexes.some((index) => index < userMessageIndex));
      assert.ok(continuationIndexes.some((index) => index > userMessageIndex));

      const sessionEntries = await readSessionEntries(sessionFile);
      const persistedContinuations = goalWorkMessages(sessionMessages(sessionEntries));
      assert.equal(persistedContinuations.length, continuations.length);
      assert.equal(persistedContinuations[0]?.content, firstContinuation.content);
    } finally {
      await rpc.close();
    }
  },
);

test(
  "real pi headless prompt drains goal continuations until completion",
  { skip: REAL_E2E_ENABLED ? false : "set PI_GOAL_REAL_E2E=1 to run provider-backed pi e2e", timeout: 180_000 },
  async () => {
    const sessionRoot = await mkdtemp(path.join(tmpdir(), "pi-goal-headless-e2e-"));
    try {
      const result = await runProcess(
        "pi",
        [
          "-p",
          "--model",
          MODEL,
          "--thinking",
          THINKING,
          "--session-dir",
          path.join(sessionRoot, "sessions"),
          "--no-extensions",
          "--extension",
          EXTENSION_PATH,
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--no-builtin-tools",
          "/goal Count visibly from 1 to 3. Each assistant turn must contain exactly one visible number, starting with 1 and increasing by 1. Do not combine numbers. After emitting a number less than 3, stop. When you have emitted 3, call update_goal with status complete.",
        ],
        { timeoutMs: 180_000 },
      );

      assert.notEqual(result.stdout.trim(), "");
      assert.notEqual(result.stdout.trim(), "1");

      const files = await findSessionFiles(sessionRoot);
      const sessionFile = files.at(-1);
      assert.ok(sessionFile, "headless prompt should create a persisted session");
      const entries = await readSessionEntries(sessionFile);
      const messages = sessionMessages(entries);
      const texts = messages
        .filter((message) => message.role === "assistant")
        .map((message) => textFromMessage(message).trim())
        .filter(Boolean);

      assert.ok(texts.includes("1"), `expected first goal turn to emit 1, got ${JSON.stringify(texts)}`);
      assert.ok(texts.includes("2"), `expected second goal turn to emit 2, got ${JSON.stringify(texts)}`);
      assert.ok(
        texts.some((text) => /\b3\b/.test(text)),
        `expected a later goal turn to mention 3, got ${JSON.stringify(texts)}`,
      );
      assert.ok(
        entries.some((entry) => {
          return (
            entry.type === "custom" &&
            entry.customType === CUSTOM_ENTRY_TYPE &&
            isObject(entry.data) &&
            entry.data.kind === "set" &&
            isObject(entry.data.goal) &&
            entry.data.goal.status === "complete"
          );
        }),
        "headless goal should persist a complete goal",
      );
    } finally {
      await rm(sessionRoot, { recursive: true, force: true });
    }
  },
);

test(
  "real pi tmux interactive goal continuation hides goal ids in persisted prompts",
  { skip: REAL_E2E_ENABLED ? false : "set PI_GOAL_REAL_E2E=1 to run provider-backed pi e2e", timeout: 180_000 },
  async () => {
    const tmux = await runProcess("tmux", ["-V"], { allowFailure: true });
    if (tmux.code !== 0) {
      return;
    }

    const sessionName = `pi-goal-e2e-${process.pid}-${Date.now()}`;
    const sessionRoot = await mkdtemp(path.join(tmpdir(), "pi-goal-tmux-e2e-"));
    const sessionDir = path.join(sessionRoot, "sessions");
    const launchCommand = [
      `cd ${path.resolve(".")}`,
      "&&",
      "pi",
      "--model",
      MODEL,
      "--thinking",
      THINKING,
      "--session-dir",
      sessionDir,
      "--no-extensions",
      "--extension",
      EXTENSION_PATH,
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-builtin-tools",
    ].join(" ");

    try {
      await runProcess("tmux", ["kill-session", "-t", sessionName], { allowFailure: true });
      await runProcess("tmux", [
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-x",
        "140",
        "-y",
        "50",
        launchCommand,
      ]);
      await sleep(3_000);
      await runProcess("tmux", [
        "send-keys",
        "-t",
        sessionName,
        "/goal Reply exactly 1, then call update_goal with status complete. Do not perform any other work.",
        "Enter",
      ]);

      let sessionFile: string | null = null;
      let finalEntries: JsonObject[] = [];
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(1_000);
        const files = await findSessionFiles(sessionRoot);
        sessionFile = files.at(-1) ?? null;
        if (!sessionFile) {
          continue;
        }
        finalEntries = await readSessionEntries(sessionFile);
        const messages = sessionMessages(finalEntries);
        const texts = messages
          .filter((message) => message.role === "assistant")
          .map((message) => textFromMessage(message).trim())
          .filter(Boolean);
        const completed = finalEntries.some((entry) => {
          return (
            entry.type === "custom" &&
            entry.customType === CUSTOM_ENTRY_TYPE &&
            isObject(entry.data) &&
            entry.data.kind === "set" &&
            isObject(entry.data.goal) &&
            entry.data.goal.status === "complete"
          );
        });
        if (texts.includes("1") && completed) {
          break;
        }
      }

      assert.ok(sessionFile, "tmux interactive run should create a persisted session");
      const messages = sessionMessages(finalEntries);
      const continuations = goalWorkMessages(messages);
      assert.ok(continuations.length >= 1);

      for (const continuation of continuations) {
        assert.equal(typeof continuation.content, "string");
        assert.ok(isObject(continuation.details));
        const goalId = continuation.details.goalId;
        if (typeof goalId !== "string") {
          assert.fail("Expected hidden continuation metadata to include goalId.");
        }
        const content = continuation.content as string;
        assert.doesNotMatch(content, new RegExp(goalId));
        assert.match(content, /<objective>/);
      }

      const pane = await runProcess("tmux", ["capture-pane", "-p", "-t", sessionName, "-S", "-180"]);
      assert.match(pane.stdout, /Goal achieved/);
    } finally {
      await runProcess("tmux", ["kill-session", "-t", sessionName], { allowFailure: true });
      await rm(sessionRoot, { recursive: true, force: true });
    }
  },
);
