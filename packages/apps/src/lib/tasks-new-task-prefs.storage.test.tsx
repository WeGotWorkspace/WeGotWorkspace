import { afterEach, describe, expect, it } from "vitest";
import {
  TASKS_NEW_TASK_PREFS_STORAGE_KEY,
  readTasksNewTaskPrefs,
  writeTasksNewTaskPrefs,
} from "@/lib/tasks-new-task-prefs";

describe("Tasks new-task defaults in storage", () => {
  afterEach(() => window.localStorage.removeItem(TASKS_NEW_TASK_PREFS_STORAGE_KEY));

  it("round-trip through localStorage", () => {
    expect(readTasksNewTaskPrefs()).toEqual({ priority: 0, status: "needs-action" });
    expect(writeTasksNewTaskPrefs({ priority: 9, status: "in-process" })).toBe(true);
    expect(readTasksNewTaskPrefs()).toEqual({ priority: 9, status: "in-process" });
  });
});
