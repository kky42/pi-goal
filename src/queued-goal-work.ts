import {
  isActiveGoalQueuedDetails,
  type QueuedGoalContextInput,
} from "./queued-goal-messages.js";
import { CUSTOM_ENTRY_TYPE } from "./types.js";

export function extensionQueuedGoalWorkMessageId(message: QueuedGoalContextInput): string | null {
  if (message.role !== "custom" || message.customType !== CUSTOM_ENTRY_TYPE) {
    return null;
  }

  if (isActiveGoalQueuedDetails(message.details)) {
    return message.details.goalId;
  }

  return null;
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
