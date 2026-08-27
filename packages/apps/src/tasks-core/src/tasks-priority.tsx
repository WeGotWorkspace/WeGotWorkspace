import { Flag } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

/** Task priority values: 0 = none, 1 = high, 5 = medium, 9 = low. */
export const TASK_PRIORITY_NONE = 0 as const;
export const TASK_PRIORITY_HIGH = 1 as const;
export const TASK_PRIORITY_MEDIUM = 5 as const;
export const TASK_PRIORITY_LOW = 9 as const;

export const COMPOSER_PRIORITY_VALUES = [
  TASK_PRIORITY_NONE,
  TASK_PRIORITY_HIGH,
  TASK_PRIORITY_MEDIUM,
  TASK_PRIORITY_LOW,
] as const;

export type TaskPriorityValue = (typeof COMPOSER_PRIORITY_VALUES)[number];

export const PRIORITY_FILTER_SLUGS = ["high", "medium", "low", "none"] as const;
export type PriorityFilterSlug = (typeof PRIORITY_FILTER_SLUGS)[number];

export const TASK_PRIORITY_FLAG_COLORS = {
  high: "#ef4444",
  medium: "#eab308",
  low: "#3b82f6",
  none: "color-mix(in oklab, var(--color-ink) 40%, transparent)",
} as const;

/** Pre-fix API responses used inverted JMAP-ish values for iCal 1/5/9. */
const LEGACY_API_PRIORITY_MAP: Readonly<Record<number, number>> = {
  10: TASK_PRIORITY_HIGH,
  6: TASK_PRIORITY_MEDIUM,
  2: TASK_PRIORITY_LOW,
};

export function isTaskPriorityNone(priority: number | string | null | undefined): boolean {
  return normalizeTaskPriority(priority) == null;
}

export function priorityFromFilterSlug(slug: string): number | null {
  switch (slug) {
    case "high":
      return TASK_PRIORITY_HIGH;
    case "medium":
      return TASK_PRIORITY_MEDIUM;
    case "low":
      return TASK_PRIORITY_LOW;
    default:
      return null;
  }
}

export function priorityLabel(
  priority: number | string | null | undefined,
  L: TasksUILabels,
): string {
  switch (normalizeTaskPriority(priority)) {
    case TASK_PRIORITY_HIGH:
      return L.priorityHigh;
    case TASK_PRIORITY_MEDIUM:
      return L.priorityMedium;
    case TASK_PRIORITY_LOW:
      return L.priorityLow;
    default:
      return L.priorityNone;
  }
}

export function normalizeTaskPriority(priority: number | string | null | undefined): number | null {
  if (priority == null) return null;
  const value = typeof priority === "string" ? Number(priority.trim()) : priority;
  if (!Number.isFinite(value) || value === TASK_PRIORITY_NONE) return null;

  if (
    value === TASK_PRIORITY_HIGH ||
    value === TASK_PRIORITY_MEDIUM ||
    value === TASK_PRIORITY_LOW
  ) {
    return value;
  }

  const legacy = LEGACY_API_PRIORITY_MAP[value];
  if (legacy !== undefined) return legacy;

  return null;
}

export function priorityFlagColor(priority: number | string | null | undefined): string {
  switch (normalizeTaskPriority(priority)) {
    case TASK_PRIORITY_HIGH:
      return TASK_PRIORITY_FLAG_COLORS.high;
    case TASK_PRIORITY_MEDIUM:
      return TASK_PRIORITY_FLAG_COLORS.medium;
    case TASK_PRIORITY_LOW:
      return TASK_PRIORITY_FLAG_COLORS.low;
    default:
      return TASK_PRIORITY_FLAG_COLORS.none;
  }
}

type PriorityFlagStyle = CSSProperties & {
  "--tasks-priority-flag-stroke"?: string;
  "--tasks-priority-flag-fill"?: string;
  stroke?: string;
  fill?: string;
};

function renderPriorityFlag(stroke: string, fill: string): ReactNode {
  const wrapperStyle: PriorityFlagStyle = {
    "--tasks-priority-flag-stroke": stroke,
    "--tasks-priority-flag-fill": fill,
  };

  return (
    <span className="tasks-priority-flag" style={wrapperStyle}>
      <Flag className="size-3.5" style={{ stroke, fill }} aria-hidden />
    </span>
  );
}

function priorityFlagStyle(priority: number | string | null | undefined): PriorityFlagStyle | null {
  const normalized = normalizeTaskPriority(priority);
  if (normalized == null) return null;

  const stroke = priorityFlagColor(normalized);
  const fill = normalized === TASK_PRIORITY_LOW ? "#ffffff" : stroke;
  return {
    "--tasks-priority-flag-stroke": stroke,
    "--tasks-priority-flag-fill": fill,
    stroke,
    fill,
  };
}

export function priorityIcon(priority: number | string | null | undefined): ReactNode {
  if (priority === TASK_PRIORITY_NONE || priority === 0 || priority === "0") {
    const noneColor = TASK_PRIORITY_FLAG_COLORS.none;
    return renderPriorityFlag(noneColor, noneColor);
  }

  const flagStyle = priorityFlagStyle(priority);
  if (flagStyle == null) return null;

  const { stroke, fill, ...wrapperStyle } = flagStyle;

  return (
    <span className="tasks-priority-flag" style={wrapperStyle}>
      <Flag className="size-3.5" style={{ stroke, fill }} aria-hidden />
    </span>
  );
}

export function priorityFilterIcon(slug: PriorityFilterSlug): ReactNode {
  if (slug === "none") return priorityIcon(TASK_PRIORITY_NONE);
  return priorityIcon(priorityFromFilterSlug(slug));
}

export function priorityFilterLabel(slug: PriorityFilterSlug, L: TasksUILabels): string {
  switch (slug) {
    case "high":
      return L.priorityHigh;
    case "medium":
      return L.priorityMedium;
    case "low":
      return L.priorityLow;
    case "none":
      return L.priorityNone;
  }
}
