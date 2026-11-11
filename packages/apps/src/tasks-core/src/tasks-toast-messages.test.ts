import { describe, expect, it } from "vitest";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import {
  tasksCompleteToastMessage,
  tasksMoveToastMessage,
} from "@/tasks-core/src/tasks-toast-messages";
import {
  buildDisplayTasks,
  filterHiddenCompletedTasks,
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
    expect(tasksMoveToastMessage(1, "Work", defaultTasksLabels)).toBe("Moved to Work");
    expect(tasksMoveToastMessage(2, "Work", defaultTasksLabels)).toBe("Moved 2 tasks to Work");
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
  });

  it("filterHiddenCompletedTasks removes completed and cancelled tasks", () => {
    const tasks = [task("open"), task("done", "completed"), task("dropped", "cancelled")];
    expect(filterHiddenCompletedTasks(tasks).map((row) => row.id)).toEqual(["open"]);
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
