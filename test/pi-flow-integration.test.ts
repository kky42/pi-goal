import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const GOAL_TYPE = "pi-codex-goal";

type Message = Record<string, any>;

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function textFromMessage(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : ""))
    .join("");
}

function hasTerminalTaskEnvelope(context: Context, taskType: "agent" | "workflow"): boolean {
  const toolName = taskType === "agent" ? "run_agent" : "run_workflow";
  return (context.messages as Message[]).some((message) => {
    if (message.role !== "toolResult" || message.toolName !== toolName) {
      return false;
    }
    try {
      const value = JSON.parse(textFromMessage(message)) as {
        task_type?: unknown;
        status?: unknown;
      };
      return value.task_type === taskType &&
        (value.status === "completed" || value.status === "failed");
    } catch {
      return false;
    }
  });
}

async function createJointSession(extensionPaths: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-goal-flow-integration-"));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const faux = fauxProvider({
    models: [{ id: "joint-model", name: "Joint Model", reasoning: false }],
  });
  const model = faux.getModel("joint-model") as Model<string>;
  await writeFile(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        [model.provider]: {
          apiKey: "test-key",
          api: model.api,
          baseUrl: model.baseUrl,
          models: [
            {
              id: model.id,
              name: model.name,
              api: model.api,
              baseUrl: model.baseUrl,
              reasoning: model.reasoning,
              input: model.input,
              cost: model.cost,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            },
          ],
        },
      },
    }),
  );

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  const modelRegistry = new ModelRegistry(modelRuntime);
  const models = createModels();
  models.setProvider(faux.provider);
  modelRegistry.registerProvider(faux.provider.id, {
    api: faux.api,
    streamSimple: (selectedModel, context, options) =>
      models.streamSimple(selectedModel, context, options),
  });
  await modelRuntime.setRuntimeApiKey(model.provider, "test-key");

  const settingsManager = SettingsManager.inMemory({});
  const sessionManager = SessionManager.inMemory(cwd);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: extensionPaths,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    settingsManager,
    sessionManager,
    resourceLoader,
  });
  await session.bindExtensions({ mode: "rpc" });

  return {
    faux,
    session,
    sessionManager,
    async dispose() {
      session.dispose();
      modelRegistry.unregisterProvider(faux.provider.id);
      models.deleteProvider(faux.provider.id);
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

function configureResponses(
  faux: ReturnType<typeof fauxProvider>,
  taskType: "agent" | "workflow",
): void {
  faux.setResponses(
    Array.from({ length: 16 }, () => (context: Context) => {
      const serialized = JSON.stringify(context.messages);
      // pi >= 1.2 declares tools in transcript system messages; context.tools is no longer populated.
      const declaredTools = (context.messages as Message[])
        .filter((message) => message.role === "system")
        .map((message) => JSON.stringify(message));
      if (!serialized.includes("<goal>")) {
        return fauxAssistantMessage("Bootstrap complete.");
      }
      if (hasTerminalTaskEnvelope(context, taskType)) {
        if (!serialized.includes('"toolName":"update_goal"')) {
          return fauxAssistantMessage(
            [fauxToolCall("update_goal", { status: "complete" })],
            { stopReason: "toolUse" },
          );
        }
        return fauxAssistantMessage("JOINT_OK");
      }
      const toolName = taskType === "agent" ? "run_agent" : "run_workflow";
      if (!serialized.includes(`"toolName":"${toolName}"`)) {
        assert.ok(
          declaredTools.some((declared) => declared.includes(`"${toolName}"`)),
          `expected ${toolName} declared to the model`,
        );
        const toolCall = taskType === "agent"
          ? fauxToolCall("run_agent", {
              label: "expected integration failure",
              prompt: "Do not launch.",
              profile: "missing-joint-test-profile",
            })
          : fauxToolCall("run_workflow", {
              name: "joint_workflow",
              script: [
                "export const meta = { name: 'joint_workflow', description: 'Joint compatibility workflow' };",
                "const result = await run_agent('Do not launch.', { label: 'expected integration failure', profile: 'missing-joint-test-profile' });",
                "return { result };",
              ].join("\n"),
            });
        return fauxAssistantMessage([toolCall], { stopReason: "toolUse" });
      }
      assert.fail("the run tool result must carry the terminal task envelope");
    }),
  );
}

for (const scenario of [
  { taskType: "agent" as const, order: "goal-first" as const },
  { taskType: "workflow" as const, order: "flow-first" as const },
]) {
  test(`pi-goal completes after a synchronous pi-flow ${scenario.taskType} tool result when loaded ${scenario.order}`, async () => {
    const goalPath = path.resolve("src/index.ts");
    const flowPath = path.resolve("node_modules/@kky42/pi-flow/index.ts");
    const extensionPaths = scenario.order === "goal-first" ? [goalPath, flowPath] : [flowPath, goalPath];
    const joint = await createJointSession(extensionPaths);
    try {
      assert.ok(joint.session.getToolDefinition("update_goal"));
      assert.ok(joint.session.getToolDefinition("run_agent"));
      assert.ok(joint.session.getToolDefinition("run_workflow"));
      configureResponses(joint.faux, scenario.taskType);

      await joint.session.prompt(
        `/goal Launch one ${scenario.taskType}, wait for its terminal result, then complete.`,
      );
      if (joint.session.messages.length === 0) {
        await joint.session.prompt("Begin the active goal.");
      }
      await waitFor(
        () =>
          joint.session.messages.some(
            (message: Message) => message.role === "toolResult" && message.toolName === "update_goal",
          ),
        "goal completion after the pi-flow tool result",
      );

      const messages = joint.session.messages as Message[];
      const executedTool = scenario.taskType === "agent" ? "run_agent" : "run_workflow";
      const executed = messages.findIndex(
        (message) => message.role === "toolResult" && message.toolName === executedTool,
      );
      assert.ok(
        hasTerminalTaskEnvelope({ messages } as Context, scenario.taskType),
        "the run tool result must carry the terminal task envelope",
      );
      const completed = messages.findIndex(
        (message) => message.role === "toolResult" && message.toolName === "update_goal",
      );
      assert.ok(completed > executed, "goal completion must follow the pi-flow tool result");

      const goalWork = messages.filter(
        (message) => message.role === "custom" && message.customType === GOAL_TYPE,
      );
      assert.equal(goalWork.length, 1, "pi-goal must not race pi-flow with a second continuation");

      const latestGoalEntry = joint.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === GOAL_TYPE)
        .at(-1);
      assert.equal(
        latestGoalEntry?.type === "custom" &&
          typeof latestGoalEntry.data === "object" &&
          latestGoalEntry.data !== null
          ? (latestGoalEntry.data as { goal?: { status?: string } }).goal?.status
          : undefined,
        "complete",
      );
    } finally {
      await joint.dispose();
    }
  });
}
