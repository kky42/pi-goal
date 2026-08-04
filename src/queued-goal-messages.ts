import { CUSTOM_ENTRY_TYPE } from "./types.js";

type GoalQueuedWorkKind = "continuation" | "command_start" | "command_resume";

export interface ActiveGoalQueuedDetails {
  kind: GoalQueuedWorkKind;
  goalId: string;
}

export interface QueuedGoalContextInput {
  role: string;
  customType?: string;
  content?: unknown;
  display?: boolean;
  details?: unknown;
  timestamp?: number;
}

export interface QueuedGoalContextCarrier extends QueuedGoalContextInput {
  timestamp: number;
}

function isQueuedGoalCustomRole(
  message: QueuedGoalContextInput,
): message is QueuedGoalContextInput & { role: "custom"; customType: typeof CUSTOM_ENTRY_TYPE } {
  return message.role === "custom" && message.customType === CUSTOM_ENTRY_TYPE;
}

export function isActiveGoalQueuedDetails(details: unknown): details is ActiveGoalQueuedDetails {
  if (details === null || typeof details !== "object") {
    return false;
  }

  const candidate = details as { kind?: unknown; goalId?: unknown };
  const kind = candidate.kind;
  return (
    (kind === "continuation" || kind === "command_start" || kind === "command_resume") &&
    typeof candidate.goalId === "string"
  );
}

export function isCommandResumeQueuedGoalMessage(message: QueuedGoalContextInput): boolean {
  return (
    isQueuedGoalCustomRole(message) &&
    isActiveGoalQueuedDetails(message.details) &&
    message.details.kind === "command_resume"
  );
}
