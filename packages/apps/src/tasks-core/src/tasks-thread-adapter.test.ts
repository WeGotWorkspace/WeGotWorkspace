import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwLiveApiEnabled: () => false,
}));

import { defaultTasksLabels as tasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  TASK_THREAD_TYPE,
  sessionPerson,
  taskThreadAdapter,
  taskThreadClient,
} from "@/tasks-core/src/tasks-thread-adapter";

describe("task thread adapter", () => {
  it("addresses the task, sends its list as scope and follows write access", () => {
    const me = { id: "alice", displayName: "Alice" };
    const adapter = taskThreadAdapter({ id: "t1", taskListId: "list-a" }, false, me, [me]);
    expect(adapter).toEqual({
      subject: { type: TASK_THREAD_TYPE, id: "t1" },
      scopeId: "list-a",
      canPost: false,
      people: [me],
      me,
    });
    expect(TASK_THREAD_TYPE).toBe("task");
  });

  it("uses one in-memory store in mock mode", () => {
    expect(taskThreadClient()).toBe(taskThreadClient());
  });

  it("names the user from the session", () => {
    expect(sessionPerson({ user: { username: "bob", displayName: "Bob B" } } as never)).toEqual({
      id: "bob",
      displayName: "Bob B",
    });
  });
});

describe("move copy says where the comments stay", () => {
  it("single task", () => {
    expect(tasksUILabels.moveTaskDescription("Private", "Groceries")).toBe(
      "Move this task to “Private”? Comments stay in “Groceries”. People in “Private” start with an empty thread.",
    );
  });

  it("toast and multi-select", () => {
    expect(tasksUILabels.toastTaskMoved(1, "Private")).toContain("comments stay in the old list");
    expect(tasksUILabels.toastTaskMoved(3, "Private")).toContain("comments stay in the old lists");
    expect(tasksUILabels.selectionMoveDescription).toContain("Their comments stay");
  });
});
