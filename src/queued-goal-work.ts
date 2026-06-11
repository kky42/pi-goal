import {
  isActiveGoalQueuedDetails,
  type QueuedGoalContextInput,
} from "./queued-goal-messages.js";
import { CUSTOM_ENTRY_TYPE, type ThreadGoal } from "./types.js";

function isSupersededContinuationDetails(details: unknown): boolean {
  return details !== null && typeof details === "object" && (details as { kind?: unknown }).kind === "superseded_continuation";
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

  return null;
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

export function agentEndMessagesIncludeQueuedGoalWork(
  messages: readonly QueuedGoalContextInput[],
): boolean {
  return messages.some((message) => extensionQueuedGoalWorkMessageId(message) !== null);
}

export function pendingStaleQueuedGoalWorkIdsFromMessages(
  messages: readonly QueuedGoalContextInput[],
  staleQueuedGoalWorkAgentEndGoalIds: ReadonlySet<string>,
): string[] {
  const goalIds: string[] = [];
  for (const message of messages) {
    const queuedGoalId = extensionQueuedGoalWorkMessageId(message);
    if (queuedGoalId !== null && staleQueuedGoalWorkAgentEndGoalIds.has(queuedGoalId)) {
      goalIds.push(queuedGoalId);
    }
  }
  return goalIds;
}
