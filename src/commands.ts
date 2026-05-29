import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { formatGoalSummary } from "./format.js";
import { replaceGoal, updateGoalStatus } from "./state.js";
import type { GoalEntrySource, ThreadGoal } from "./types.js";

export interface CommandHost {
  getGoal(): ThreadGoal | null;
  setGoal(goal: ThreadGoal, source: GoalEntrySource, ctx: GoalCommandContext): void;
  clearGoal(source: GoalEntrySource, ctx: GoalCommandContext): void;
  requestContinuation(ctx: GoalCommandContext): void;
}

const COMMANDS = ["pause", "resume", "clear"] as const;
const GOLDEN_SET_BANNER = "\x1b[38;5;220mGoal set.\x1b[39m";

export type GoalCommandPi = Pick<ExtensionAPI, "registerCommand">;

export interface GoalCommandContext {
  hasUI: boolean;
  ui: Pick<ExtensionCommandContext["ui"], "confirm" | "notify" | "setStatus">;
}

function completions(prefix: string) {
  return COMMANDS.filter((command) => command.startsWith(prefix)).map((command) => ({
    value: command,
    label: command,
    description: `goal ${command}`,
  }));
}

export async function handleGoalCommand(
  _pi: GoalCommandPi,
  host: CommandHost,
  args: string,
  ctx: GoalCommandContext,
): Promise<void> {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    ctx.ui.notify(formatGoalSummary(host.getGoal()));
    return;
  }

  if (trimmed === "clear") {
    const goal = host.getGoal();
    if (!goal) {
      ctx.ui.notify("No goal is set.", "warning");
      return;
    }
    host.clearGoal("command", ctx);
    ctx.ui.notify("Goal cleared.");
    return;
  }

  if (trimmed === "pause" || trimmed === "resume") {
    const current = host.getGoal();
    const status = trimmed === "pause" ? "paused" : "active";
    const result = updateGoalStatus(current, status);
    if (!result.ok || !result.goal) {
      ctx.ui.notify(result.message, "warning");
      return;
    }
    host.setGoal(result.goal, "command", ctx);
    ctx.ui.notify(result.message);
    if (trimmed === "resume" && result.goal.status === "active") {
      host.requestContinuation(ctx);
    }
    return;
  }

  const current = host.getGoal();
  if (current && current.status !== "complete") {
    if (!ctx.hasUI) {
      ctx.ui.notify("Clear the existing goal before replacing it.", "error");
      return;
    }
    const shouldReplace = await ctx.ui.confirm(
      "Replace goal?",
      `Current goal:\n${current.objective}\n\nNew goal:\n${trimmed}`,
    );
    if (!shouldReplace) {
      ctx.ui.notify("Goal unchanged.");
      return;
    }
  }

  const result = replaceGoal(trimmed);
  if (!result.ok || !result.goal) {
    ctx.ui.notify(result.message, "error");
    return;
  }
  host.setGoal(result.goal, "command", ctx);
  ctx.ui.notify([GOLDEN_SET_BANNER, formatGoalSummary(result.goal)].join("\n"));
  host.requestContinuation(ctx);
}

export function registerGoalCommand(pi: GoalCommandPi, host: CommandHost): void {
  pi.registerCommand("goal", {
    description: "Show or manage the current Codex-style goal.",
    getArgumentCompletions(argumentPrefix) {
      return completions(argumentPrefix.trim());
    },
    async handler(args: string, ctx: ExtensionCommandContext) {
      await handleGoalCommand(pi, host, args, ctx);
    },
  });
}
