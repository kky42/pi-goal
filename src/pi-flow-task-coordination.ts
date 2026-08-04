import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_FLOW_TASK_STATE_CHANNEL = "pi-flow:task-state";

type PiFlowTaskState = {
  version: 1;
  task_id: string;
  task_type: "agent" | "workflow";
  status: "accepted" | "completed" | "failed";
};

function isPiFlowTaskState(value: unknown): value is PiFlowTaskState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const keys = ["version", "task_id", "task_type", "status"];
  return (
    keys.every((key) => Object.hasOwn(payload, key)) &&
    Object.keys(payload).length === keys.length &&
    payload.version === 1 &&
    typeof payload.task_id === "string" &&
    (payload.task_type === "agent" || payload.task_type === "workflow") &&
    (payload.status === "accepted" || payload.status === "completed" || payload.status === "failed")
  );
}

export function registerPiFlowTaskCoordination(
  pi: Pick<ExtensionAPI, "events" | "on">,
  pendingTaskIds: Set<string>,
  cancelScheduledContinuation: () => void,
): void {
  const unsubscribe = pi.events.on(PI_FLOW_TASK_STATE_CHANNEL, (value) => {
    if (!isPiFlowTaskState(value)) {
      return;
    }

    if (value.status === "accepted") {
      pendingTaskIds.add(value.task_id);
      cancelScheduledContinuation();
      return;
    }

    pendingTaskIds.delete(value.task_id);
  });
  pi.on("session_shutdown", unsubscribe);
}
