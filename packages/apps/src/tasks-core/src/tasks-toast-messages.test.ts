import { describe, expect, it } from "vitest";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import {
  tasksCompleteToastMessage,
  tasksMoveToastMessage,
} from "@/tasks-core/src/tasks-toast-messages";
import {
  buildDisplayTasks,
  DEFAULT_TASK_PRIORITY_FILTER,
  DEFAULT_TASK_STATUS_FILTER,
  filterTasksByPriorityFilter,
  filterTasksByStatus,
  shouldApplyCompletedTaskFilter,
  shouldHideCompletedTaskAfterExit,
} from "@/tasks-core/src/tasks-task-utils";
import type { Task } from "@/lib/models/tasks-types";

const task = (id: string, status: Task["workflowStatus"] = "needs-action"): Task => ({
  "@type": "Task",
  id,
  uid: `urn:uuid:test-${id}`,
  title: `Task ${id}`,
  workflowStatus: status,
  taskListId: "inbox",
  isDraft: false,
  sortOrder: 0,
});

describe("tasks toast messages", () => {
  it("returns complete vs reopened copy", () => {
    expect(tasksCompleteToastMessage(true, 1, defaultTasksLabels)).toBe("Task completed");
    expect(tasksCompleteToastMessage(true, 3, defaultTasksLabels)).toBe("3 tasks completed");
    expect(tasksCompleteToastMessage(false, 1, defaultTasksLabels)).toBe("Marked incomplete");
  });

  it("formats move toasts", () => {
    expect(tasksMoveToastMessage(1, "Work", defaultTasksLabels)).toBe(
      "Moved to Work. Its comments stay in the old list.",
    );
    expect(tasksMoveToastMessage(2, "Work", defaultTasksLabels)).toBe(
      "Moved 2 tasks to Work. Their comments stay in the old lists.",
    );
  });
});

describe("shouldHideCompletedTaskAfterExit", () => {
  it("hides after exit in all and list views", () => {
    expect(shouldHideCompletedTaskAfterExit("state:all")).toBe(true);
    expect(shouldHideCompletedTaskAfterExit("list:inbox")).toBe(true);
  });

  it("does not hide after exit in filtered status views", () => {
    expect(shouldHideCompletedTaskAfterExit("state:needs-action")).toBe(false);
    expect(shouldHideCompletedTaskAfterExit("state:today")).toBe(false);
  });
});

describe("completed task visibility filter", () => {
  it("shouldApplyCompletedTaskFilter excludes dedicated completed and cancelled views", () => {
    expect(shouldApplyCompletedTaskFilter("state:all")).toBe(true);
    expect(shouldApplyCompletedTaskFilter("list:inbox")).toBe(true);
    expect(shouldApplyCompletedTaskFilter("state:completed")).toBe(false);
    expect(shouldApplyCompletedTaskFilter("state:cancelled")).toBe(false);
    expect(shouldApplyCompletedTaskFilter("state:needs-action")).toBe(false);
    expect(shouldApplyCompletedTaskFilter("state:in-process")).toBe(false);
  });

  it("the default status filter keeps open work and drops completed and cancelled tasks", () => {
    const tasks = [task("open"), task("done", "completed"), task("dropped", "cancelled")];
    expect(filterTasksByStatus(tasks, DEFAULT_TASK_STATUS_FILTER).map((row) => row.id)).toEqual([
      "open",
    ]);
    expect(filterTasksByStatus(tasks, new Set(["completed"])).map((row) => row.id)).toEqual([
      "done",
    ]);
  });

  it("filters by priority, with none as its own segment row", () => {
    const tasks = [
      { ...task("hi"), priority: 1 },
      { ...task("lo"), priority: 9 },
      { ...task("none"), priority: 0 },
    ];
    const ids = (allowed: ReadonlySet<"high" | "medium" | "low" | "none">) =>
      filterTasksByPriorityFilter(tasks, allowed).map((row) => row.id);
    expect(ids(DEFAULT_TASK_PRIORITY_FILTER)).toEqual(["hi", "lo", "none"]);
    expect(ids(new Set(["high"]))).toEqual(["hi"]);
    expect(ids(new Set(["low", "none"]))).toEqual(["lo", "none"]);
  });
});

describe("buildDisplayTasks", () => {
  const tasks = [task("a"), task("b"), task("c", "completed")];
  const visibleTasks = [task("a"), task("b")];

  it("keeps visible tasks and excludes hidden ones", () => {
    const result = buildDisplayTasks(tasks, visibleTasks, new Set(), new Set(["b"]));
    expect(result.map((row) => row.id)).toEqual(["a"]);
  });

  it("keeps exiting tasks visible until animation finishes", () => {
    const result = buildDisplayTasks(tasks, [task("a")], new Set(["b"]), new Set());
    expect(result.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("shows exiting tasks even when hidden after undo restore", () => {
    const result = buildDisplayTasks(tasks, visibleTasks, new Set(["b"]), new Set(["b"]));
    expect(result.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
