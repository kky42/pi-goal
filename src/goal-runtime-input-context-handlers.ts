import type {
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionHandler,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";

import { activeGoalContextPrompt, continuationGoalIdFromPrompt } from "./prompts.js";
import { applyQueuedGoalProviderContextRewrites, extensionQueuedGoalWorkMessageId } from "./queued-goal-work.js";
import { isActiveGoalQueuedDetails, isCommandResumeQueuedGoalMessage } from "./queued-goal-messages.js";
import { applyStaleQueuedWorkEffects } from "./goal-runtime-event-utils.js";
import type {
  ContextEventResult,
  GoalRuntimeInputContextHandlerContext,
  MessageStartEvent,
  QueuedGoalWorkMessageIdResolver,
} from "./goal-runtime-event-handler-types.js";
import { CUSTOM_ENTRY_TYPE, type ThreadGoal } from "./types.js";

function goalIdFromQueuedDetails(details: unknown): string | null {
  return isActiveGoalQueuedDetails(details) ? details.goalId : null;
}

function goalIdFromEventDetails(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const candidate = event as { details?: unknown; message?: { details?: unknown } };
  return goalIdFromQueuedDetails(candidate.details) ?? goalIdFromQueuedDetails(candidate.message?.details);
}

function createActiveGoalContextMessage(goal: ThreadGoal): ContextEvent["messages"][number] {
  return {
    role: "custom",
    customType: CUSTOM_ENTRY_TYPE,
    content: activeGoalContextPrompt(goal),
    display: false,
    details: { kind: "active_goal_context", goalId: goal.goalId },
    timestamp: Date.now(),
  };
}

export function createInputContextEventHandlers(
  deps: GoalRuntimeInputContextHandlerContext,
  queuedGoalWorkMessageIdForRuntime: QueuedGoalWorkMessageIdResolver,
) {
  const { runtimeState, stateController, continuation, recoveryRuntime, status, resetErrorRecovery } = deps;

  return {
    onInput: (async (event, ctx) => {
      continuation.clearPassthroughContinuationInput();
      const continuationGoalId = goalIdFromEventDetails(event) ?? continuationGoalIdFromPrompt(event.text);

      if (event.source !== "extension") {
        recoveryRuntime.onUserInput();
        applyStaleQueuedWorkEffects(
          runtimeState.staleQueuedWorkGuard.planUserInputClearAbort().effects,
          ctx,
          deps,
        );
        if (continuationGoalId !== null) {
          continuation.notePassthroughContinuationInput(event.text);
        }
        return undefined;
      }

      if (continuationGoalId === null) {
        return undefined;
      }

      applyStaleQueuedWorkEffects(
        runtimeState.staleQueuedWorkGuard.planExtensionContinuationClearAbort().effects,
        ctx,
        deps,
      );
      continuation.clearContinuationStateFor(continuationGoalId);
      if (stateController.isCurrentActiveGoalId(continuationGoalId)) {
        return { action: "continue" } as const;
      }

      status.refreshUi(ctx);
      return { action: "handled" } as const;
    }) satisfies ExtensionHandler<InputEvent, InputEventResult>,

    onContext: (async (event, ctx) => {
      const goal = stateController.getGoal();
      const rewrite = applyQueuedGoalProviderContextRewrites(event.messages, {
        goal,
        resolveStaleQueuedGoalWorkMessageId: queuedGoalWorkMessageIdForRuntime,
        resolveActiveContinuationQueuedGoalWorkMessageId: extensionQueuedGoalWorkMessageId,
      });

      const contextMessages =
        goal?.status === "active"
          ? [...rewrite.messages, createActiveGoalContextMessage(goal)]
          : rewrite.messages;
      const changed = rewrite.changed || contextMessages.length !== event.messages.length;

      const contextAbortPlan = runtimeState.staleQueuedWorkGuard.planContextAbort(
        runtimeState.currentTurnIndex,
      );
      if (contextAbortPlan !== null) {
        applyStaleQueuedWorkEffects(contextAbortPlan.effects, ctx, deps);
      }

      return changed ? { messages: contextMessages } : undefined;
    }) satisfies ExtensionHandler<ContextEvent, ContextEventResult | undefined>,

    onBeforeAgentStart: (async (event, ctx) => {
      const continuationGoalId =
        goalIdFromEventDetails(event) ?? continuation.continuationGoalIdFromRuntimePrompt(event.prompt);
      if (continuationGoalId !== null) {
        continuation.clearContinuationStateFor(continuationGoalId);
        if (!stateController.isCurrentActiveGoalId(continuationGoalId)) {
          runtimeState.staleQueuedWorkGuard.noteStaleWorkStarted(continuationGoalId);
          status.refreshUi(ctx);
          return undefined;
        }
        applyStaleQueuedWorkEffects(
          runtimeState.staleQueuedWorkGuard.planBeforeAgentStartClearAbort().effects,
          ctx,
          deps,
        );
      } else {
        applyStaleQueuedWorkEffects(
          runtimeState.staleQueuedWorkGuard.planBeforeAgentStartClearAbort().effects,
          ctx,
          deps,
        );
        continuation.clearContinuationState();
      }
      return undefined;
    }) satisfies ExtensionHandler<BeforeAgentStartEvent, undefined>,

    onMessageStart: (async (event, _ctx) => {
      if (event.message.role === "user") {
        stateController.persistHostOverflowUserReset(false);
      }

      const queuedGoalId = queuedGoalWorkMessageIdForRuntime(event.message);
      if (queuedGoalId === null) {
        if (event.message.role === "user" || event.message.role === "custom") {
          runtimeState.staleQueuedWorkGuard.noteRunnableWorkStarted();
          continuation.clearContinuationState();
        }
        return;
      }

      continuation.clearContinuationStateFor(queuedGoalId);
      if (stateController.isCurrentActiveGoalId(queuedGoalId)) {
        runtimeState.staleQueuedWorkGuard.noteRunnableWorkStarted();
        if (isCommandResumeQueuedGoalMessage(event.message)) {
          resetErrorRecovery();
        }
        return;
      }

      runtimeState.staleQueuedWorkGuard.noteStaleWorkStarted(queuedGoalId);
    }) satisfies ExtensionHandler<MessageStartEvent>,
  };
}
