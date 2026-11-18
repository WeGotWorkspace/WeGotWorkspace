import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/models/tasks-types";
import { taskEditPatch } from "@/tasks-core/src/use-task-detail-autosave";

const task = {
  id: "t1",
  title: "Buy milk ",
  description: "Two cartons ",
  priority: null,
} as unknown as Task;

const next = {
  title: "Buy milk",
  description: "Two cartons",
  workflowStatus: "needs-action" as const,
  priority: 5,
  due: null,
  showWithoutTime: undefined,
  timeZone: null,
  alerts: undefined,
};

describe("taskEditPatch in a room", () => {
  it("names neither the title nor the description when the room holds the text", () => {
    const patch = taskEditPatch(task, next, { skipText: true });
    expect(patch).not.toHaveProperty("title");
    expect(patch).not.toHaveProperty("description");
    expect(patch.priority).toBe(5);
  });

  it("still names a changed title outside a room", () => {
    expect(taskEditPatch(task, next).title).toBe("Buy milk");
  });
});
