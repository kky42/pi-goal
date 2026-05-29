import { continuationGoalIdFromPrompt } from "./prompts.js";
import {
  isActiveGoalQueuedDetails,
  type QueuedGoalContextInput,
  userContentFromUnknown,
} from "./queued-goal-messages.js";
import { CUSTOM_ENTRY_TYPE, type ThreadGoal } from "./types.js";

function isSupersededContinuationDetails(details: unknown): boolean {
  return details !== null && typeof details === "object" && (details as { kind?: unknown }).kind === "superseded_continuation";
}

function textContentFromMessageContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  const parts = userContentFromUnknown(content);
  if (parts.length === 0) {
    return null;
  }

  return parts.map((part) => part.text).join("\n");
}

function continuationGoalIdFromMessageContent(content: unknown): string | null {
  const text = textContentFromMessageContent(content);
  return text === null ? null : continuationGoalIdFromPrompt(text);
}

export function extensionQueuedGoalWorkMessageId(message: QueuedGoalContextInput): string | null {
  if (message.role !== "custom" || message.customType !== CUSTOM_ENTRY_TYPE) {
    return null;
  }

  if (isSupersededContinuationDetails(message.details)) {
    return null;
  }

  if (isActiveGoalQueuedDetails(message.details)) {
    return message.details.goalId;
  }

  return continuationGoalIdFromMessageContent(message.content);
}

function queuedGoalWorkMessageId(message: QueuedGoalContextInput): string | null {
  if (message.role === "user") {
    return continuationGoalIdFromMessageContent(message.content);
  }

  return extensionQueuedGoalWorkMessageId(message);
}

export function applyQueuedGoalProviderContextRewrites<TMessage extends QueuedGoalContextInput>(
  messages: readonly TMessage[],
  _options: {
    goal: ThreadGoal | null;
    resolveStaleQueuedGoalWorkMessageId: (message: QueuedGoalContextInput) => string | null;
    resolveActiveContinuationQueuedGoalWorkMessageId: (message: QueuedGoalContextInput) => string | null;
  },
): { messages: TMessage[]; changed: boolean } {
  return { messages: [...messages], changed: false };
}

export function extensionQueuedGoalWorkMessageIdForRuntime(
  message: QueuedGoalContextInput,
  resolveContinuationGoalIdFromPrompt: (prompt: string) => string | null,
): string | null {
  if (message.role === "user") {
    const text = textContentFromMessageContent(message.content);
    return text === null ? null : resolveContinuationGoalIdFromPrompt(text);
  }

  return queuedGoalWorkMessageId(message);
}

export function agentEndMessagesIncludeQueuedGoalWork(
  messages: readonly QueuedGoalContextInput[],
): boolean {
  return messages.some((message) => queuedGoalWorkMessageId(message) !== null);
}

export function pendingStaleQueuedGoalWorkIdsFromMessages(
  messages: readonly QueuedGoalContextInput[],
  staleQueuedGoalWorkAgentEndGoalIds: ReadonlySet<string>,
): string[] {
  const goalIds: string[] = [];
  for (const message of messages) {
    const queuedGoalId = queuedGoalWorkMessageId(message);
    if (queuedGoalId !== null && staleQueuedGoalWorkAgentEndGoalIds.has(queuedGoalId)) {
      goalIds.push(queuedGoalId);
    }
  }
  return goalIds;
}
