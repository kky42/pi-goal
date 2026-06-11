import type { GoalStatus, ThreadGoal } from "./types.js";

const COMPACT_TOKEN_UNITS = [
  { suffix: "T", value: 1_000_000_000_000 },
  { suffix: "B", value: 1_000_000_000 },
  { suffix: "M", value: 1_000_000 },
  { suffix: "K", value: 1_000 },
] as const;

export interface GoalToolRecord {
  objective: string;
  status: GoalStatus;
  tokensUsed: number;
  timeUsed: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalToolResponse {
  goal: GoalToolRecord | null;
}

export function formatDuration(seconds: number): string {
  const normalized = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(normalized / 3_600);
  const minutes = Math.floor((normalized % 3_600) / 60);
  const remainingSeconds = normalized % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalTimestamp(unixSeconds: number): string {
  const date = new Date(Math.max(0, Math.trunc(unixSeconds)) * 1000);
  const day = `${date.getFullYear()}-${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())}`;
  const time = `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`;
  return `${day} ${time}`;
}

export function formatInteger(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

export function formatCompactTokenValue(value: number): string {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized < 100_000) {
    return formatInteger(normalized);
  }

  const unit = COMPACT_TOKEN_UNITS.find((candidate) => normalized >= candidate.value);
  if (!unit) {
    return formatInteger(normalized);
  }

  const scaled = normalized / unit.value;
  const fractionDigits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const compact = scaled.toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
  return `${compact}${unit.suffix}`;
}

export function formatTokenValue(value: number): string {
  const exact = formatInteger(value);
  const compact = formatCompactTokenValue(value);
  if (compact === exact) {
    return exact;
  }
  return `${compact} (${exact})`;
}

function commandHint(status: GoalStatus): string {
  if (status === "active") {
    return "/goal pause, /goal clear";
  }
  if (status === "paused") {
    return "/goal resume, /goal clear";
  }
  if (status === "blocked") {
    return "/goal resume, /goal clear";
  }
  return "/goal <objective> to replace, /goal clear";
}

export function formatBudget(goal: ThreadGoal): string {
  return `${formatTokenValue(goal.usage.tokensUsed)} tokens`;
}

export function formatGoalSummary(goal: ThreadGoal | null): string {
  if (!goal) {
    return ["Usage: /goal <objective>", "No goal is currently set."].join("\n");
  }

  return [
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    `Hint: ${commandHint(goal.status)}`,
  ].join("\n");
}

export function formatFooterStatus(goal: ThreadGoal | null, recoveryAttention: string | null = null): string | undefined {
  if (!goal) {
    return undefined;
  }

  if (recoveryAttention) {
    return recoveryAttention;
  }

  if (goal.status === "active") {
    return "Pursuing goal";
  }

  if (goal.status === "paused") {
    return "Goal paused (/goal resume)";
  }

  if (goal.status === "blocked") {
    return "Goal blocked (/goal resume)";
  }

  return "Goal achieved";
}

export function toToolGoal(goal: ThreadGoal): GoalToolRecord {
  return {
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.usage.tokensUsed,
    timeUsed: formatDuration(goal.usage.activeSeconds),
    createdAt: formatLocalTimestamp(goal.createdAt),
    updatedAt: formatLocalTimestamp(goal.updatedAt),
  };
}

export function goalToolResponse(goal: ThreadGoal | null): GoalToolResponse {
  return {
    goal: goal ? toToolGoal(goal) : null,
  };
}

export function toToolText(goal: ThreadGoal | null): string {
  return JSON.stringify(goalToolResponse(goal), null, 2);
}
