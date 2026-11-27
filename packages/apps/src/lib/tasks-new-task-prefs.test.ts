import { describe, expect, it } from "vitest";
import { DEFAULT_TASKS_NEW_TASK_PREFS, parseTasksNewTaskPrefs } from "@/lib/tasks-new-task-prefs";

describe("Tasks new-task defaults", () => {
  it("start as no priority and not started", () => {
    expect(DEFAULT_TASKS_NEW_TASK_PREFS).toEqual({ priority: 0, status: "needs-action" });
    expect(parseTasksNewTaskPrefs(null)).toEqual(DEFAULT_TASKS_NEW_TASK_PREFS);
  });

  it("keep a stored priority and status", () => {
    expect(parseTasksNewTaskPrefs(JSON.stringify({ priority: 1, status: "in-process" }))).toEqual({
      priority: 1,
      status: "in-process",
    });
  });

  it("fall back to the default for a value that is not offered", () => {
    // Completed and cancelled are not starting points; 3 is no priority.
    expect(parseTasksNewTaskPrefs(JSON.stringify({ priority: 3, status: "completed" }))).toEqual(
      DEFAULT_TASKS_NEW_TASK_PREFS,
    );
    expect(parseTasksNewTaskPrefs("not json")).toEqual(DEFAULT_TASKS_NEW_TASK_PREFS);
  });
});
