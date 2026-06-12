import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { formatFooterStatus } from "./format.js";
import type { GoalRecoveryMachineState } from "./recovery-machine.js";
import type { ThreadGoal } from "./types.js";

export interface StatusContext {
  ui: Pick<ExtensionContext["ui"], "setStatus" | "theme">;
}

interface GoalRuntimeStatusDeps {
  getGoalForDisplay: () => ThreadGoal | null;
  getGoalStatus: () => ThreadGoal["status"] | null;
  getRecoveryAttention: () => GoalRecoveryMachineState["attention"];
}

type Theme = ExtensionContext["ui"]["theme"];

type ThemeColor = Parameters<Theme["fg"]>[0];

function themeFg(theme: Theme, color: ThemeColor, text: string): string {
  const fg = (theme as { fg?: Theme["fg"] }).fg;
  if (typeof fg !== "function") {
    return text;
  }
  return fg.call(theme, color, text);
}

function formatThemedFooterStatus(
  theme: Theme,
  goal: ThreadGoal | null,
  recoveryAttention: GoalRecoveryMachineState["attention"],
): string | undefined {
  const status = formatFooterStatus(goal, recoveryAttention);
  if (!status) {
    return undefined;
  }

  if (recoveryAttention) {
    return themeFg(theme, "warning", status);
  }

  if (goal?.status === "active") {
    const label = "Pursuing goal";
    if (status.startsWith(`${label} (`)) {
      return themeFg(theme, "accent", label) + themeFg(theme, "dim", status.slice(label.length));
    }
    return themeFg(theme, "accent", status);
  }

  if (goal?.status === "paused" || goal?.status === "blocked") {
    return themeFg(theme, "warning", status);
  }

  if (goal?.status === "complete") {
    return themeFg(theme, "success", status);
  }

  return status;
}

export function createGoalRuntimeStatus(deps: GoalRuntimeStatusDeps) {
  let statusContext: StatusContext | null = null;
  let statusRefreshTimer: ReturnType<typeof setInterval> | null = null;

  const stopStatusRefresh = (): void => {
    if (statusRefreshTimer) {
      clearInterval(statusRefreshTimer);
      statusRefreshTimer = null;
    }
  };

  const syncStatusRefresh = (): void => {
    if (deps.getGoalStatus() === "active" && statusContext && !statusRefreshTimer) {
      statusRefreshTimer = setInterval(() => {
        if (!statusContext || deps.getGoalStatus() !== "active") {
          stopStatusRefresh();
          return;
        }
        statusContext.ui.setStatus(
          "codex-goal",
          formatThemedFooterStatus(
            statusContext.ui.theme,
            deps.getGoalForDisplay(),
            deps.getRecoveryAttention(),
          ),
        );
      }, 1_000);
      statusRefreshTimer.unref?.();
      return;
    }

    if (deps.getGoalStatus() !== "active") {
      stopStatusRefresh();
    }
  };

  const refreshUi = (ctx: StatusContext): void => {
    statusContext = ctx;
    ctx.ui.setStatus(
      "codex-goal",
      formatThemedFooterStatus(ctx.ui.theme, deps.getGoalForDisplay(), deps.getRecoveryAttention()),
    );
    syncStatusRefresh();
  };

  return {
    refreshUi,
    stopStatusRefresh,
  };
}
