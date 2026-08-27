import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TASK_PRIORITY_FLAG_COLORS,
  TASK_PRIORITY_HIGH,
  TASK_PRIORITY_LOW,
  TASK_PRIORITY_MEDIUM,
  isTaskPriorityNone,
  normalizeTaskPriority,
  PRIORITY_FILTER_SLUGS,
  priorityFilterIcon,
  priorityFilterLabel,
  priorityFlagColor,
  priorityIcon,
} from "@/tasks-core/src/tasks-priority";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";

describe("normalizeTaskPriority", () => {
  it("maps canonical iCal tiers", () => {
    expect(normalizeTaskPriority(1)).toBe(TASK_PRIORITY_HIGH);
    expect(normalizeTaskPriority(5)).toBe(TASK_PRIORITY_MEDIUM);
    expect(normalizeTaskPriority(9)).toBe(TASK_PRIORITY_LOW);
  });

  it("coerces string numbers", () => {
    expect(normalizeTaskPriority("1")).toBe(TASK_PRIORITY_HIGH);
    expect(normalizeTaskPriority(" 5 ")).toBe(TASK_PRIORITY_MEDIUM);
  });

  it("maps legacy inverted API values", () => {
    expect(normalizeTaskPriority(10)).toBe(TASK_PRIORITY_HIGH);
    expect(normalizeTaskPriority(6)).toBe(TASK_PRIORITY_MEDIUM);
    expect(normalizeTaskPriority(2)).toBe(TASK_PRIORITY_LOW);
  });

  it("treats none values as null", () => {
    expect(normalizeTaskPriority(null)).toBeNull();
    expect(normalizeTaskPriority(undefined)).toBeNull();
    expect(normalizeTaskPriority(0)).toBeNull();
    expect(normalizeTaskPriority("0")).toBeNull();
  });

  it("rejects unknown values", () => {
    expect(normalizeTaskPriority(3)).toBeNull();
    expect(normalizeTaskPriority("high")).toBeNull();
  });
});

describe("priorityFlagColor", () => {
  it("returns explicit hex colors for high, medium, and low", () => {
    expect(priorityFlagColor(1)).toBe(TASK_PRIORITY_FLAG_COLORS.high);
    expect(priorityFlagColor(5)).toBe(TASK_PRIORITY_FLAG_COLORS.medium);
    expect(priorityFlagColor(9)).toBe(TASK_PRIORITY_FLAG_COLORS.low);
    expect(priorityFlagColor("1")).toBe(TASK_PRIORITY_FLAG_COLORS.high);
  });

  it("returns muted color only for none", () => {
    expect(priorityFlagColor(null)).toBe(TASK_PRIORITY_FLAG_COLORS.none);
    expect(priorityFlagColor(0)).toBe(TASK_PRIORITY_FLAG_COLORS.none);
  });
});

describe("priorityIcon", () => {
  it("sets CSS vars for high priority", () => {
    const { container } = render(priorityIcon(1));
    const wrapper = container.querySelector(".tasks-priority-flag") as HTMLElement;
    expect(wrapper.style.getPropertyValue("--tasks-priority-flag-stroke")).toBe(
      TASK_PRIORITY_FLAG_COLORS.high,
    );
    expect(wrapper.style.getPropertyValue("--tasks-priority-flag-fill")).toBe(
      TASK_PRIORITY_FLAG_COLORS.high,
    );
  });

  it("renders nothing for null, undefined, and invalid values", () => {
    expect(render(priorityIcon(null)).container.querySelector(".tasks-priority-flag")).toBeNull();
    expect(
      render(priorityIcon(undefined)).container.querySelector(".tasks-priority-flag"),
    ).toBeNull();
    expect(render(priorityIcon(3)).container.querySelector(".tasks-priority-flag")).toBeNull();
  });

  it("renders muted flag only for explicit composer none", () => {
    const { container } = render(priorityIcon(0));
    const wrapper = container.querySelector(".tasks-priority-flag") as HTMLElement;
    expect(wrapper.style.getPropertyValue("--tasks-priority-flag-fill")).toBe(
      TASK_PRIORITY_FLAG_COLORS.none,
    );
  });
});

describe("priority filter slugs", () => {
  it("includes none alongside high, medium, and low", () => {
    expect(PRIORITY_FILTER_SLUGS).toEqual(["high", "medium", "low", "none"]);
    expect(priorityFilterLabel("none", defaultTasksLabels)).toBe(defaultTasksLabels.priorityNone);
    const { container } = render(priorityFilterIcon("none"));
    expect(container.querySelector(".tasks-priority-flag")).toBeTruthy();
  });
});

describe("isTaskPriorityNone", () => {
  it("treats nullish and legacy unknown values as none", () => {
    expect(isTaskPriorityNone(null)).toBe(true);
    expect(isTaskPriorityNone(undefined)).toBe(true);
    expect(isTaskPriorityNone(0)).toBe(true);
    expect(isTaskPriorityNone(3)).toBe(true);
    expect(isTaskPriorityNone(10)).toBe(false);
  });
});
