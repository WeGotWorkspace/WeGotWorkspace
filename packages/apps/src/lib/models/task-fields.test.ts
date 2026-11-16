import { describe, expect, it } from "vitest";
import {
  isTaskCompleted,
  parseDueDateValue,
  taskDueIsDateOnly,
  taskListTitle,
} from "@/lib/models/task-fields";
import type { Task } from "@/lib/models/tasks-types";

const task = (over: Partial<Task>) => over as Task;

describe("task-fields", () => {
  it("taskListTitle trims and falls back", () => {
    expect(taskListTitle(task({ title: " Milk " }), "Untitled")).toBe("Milk");
    expect(taskListTitle(task({ title: "  " }), "Untitled")).toBe("Untitled");
    expect(taskListTitle(task({}), "Untitled")).toBe("Untitled");
  });

  it("parseDueDateValue handles date-only, date-time, other and invalid input", () => {
    expect(parseDueDateValue(null)).toBeUndefined();
    expect(parseDueDateValue("  ")).toBeUndefined();
    expect(parseDueDateValue("2026-03-04")?.getDate()).toBe(4);
    const dt = parseDueDateValue("2026-03-04T10:30");
    expect([dt?.getHours(), dt?.getMinutes(), dt?.getSeconds()]).toEqual([10, 30, 0]);
    expect(parseDueDateValue("2026-03-04T10:30:15")?.getSeconds()).toBe(15);
    expect(parseDueDateValue("March 4, 2026 10:00")).toBeInstanceOf(Date);
    expect(parseDueDateValue("nonsense")).toBeUndefined();
  });

  it("taskDueIsDateOnly prefers the explicit flag, then the string shape", () => {
    expect(taskDueIsDateOnly(null)).toBe(true);
    expect(taskDueIsDateOnly("2026-03-04T10:00", true)).toBe(true);
    expect(taskDueIsDateOnly("2026-03-04", false)).toBe(false);
    expect(taskDueIsDateOnly("2026-03-04T10:00")).toBe(false);
    expect(taskDueIsDateOnly("2026-03-04")).toBe(true);
  });

  it("isTaskCompleted counts completed and cancelled", () => {
    expect(isTaskCompleted(task({ workflowStatus: "completed" }))).toBe(true);
    expect(isTaskCompleted(task({ workflowStatus: "cancelled" }))).toBe(true);
    expect(isTaskCompleted(task({ workflowStatus: "needs-action" as never }))).toBe(false);
  });
});
