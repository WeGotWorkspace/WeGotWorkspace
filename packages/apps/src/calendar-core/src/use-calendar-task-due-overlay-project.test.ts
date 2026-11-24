import { describe, expect, it } from "vitest";
import { overlayStateFromData } from "@/calendar-core/src/use-calendar-task-due-overlay";
import type { TasksUIData } from "@/lib/models/tasks-types";

const data = {
  taskLists: [
    { id: "inbox", name: "Inbox", projectId: null },
    { id: "team", name: "Team", projectId: "p1" },
    { id: "team-b", name: "Team B", projectId: "p2" },
    { id: "other", name: "Other", projectId: "p3" },
  ],
  tasks: [
    { id: "a", taskListId: "inbox", title: "Personal" },
    { id: "b", taskListId: "team", title: "Team task" },
    { id: "c", taskListId: "team-b", title: "Second Project task" },
    { id: "d", taskListId: "other", title: "Other Team task" },
  ],
} as unknown as TasksUIData;

describe("Calendar reminders under the Project filter", () => {
  it("keeps every list for All Projects", () => {
    const state = overlayStateFromData(data, new Set());
    expect(state.taskLists.map((list) => list.id)).toEqual(["inbox", "team", "team-b", "other"]);
    expect(state.tasks).toHaveLength(4);
  });

  it("keeps only the Project's list and its tasks", () => {
    const state = overlayStateFromData(data, new Set(), ["p1"]);
    expect(state.taskLists.map((list) => list.id)).toEqual(["team"]);
    expect(state.tasks.map((task) => task.id)).toEqual(["b"]);
  });

  it("keeps the lists of every Project of a Team, none of another Team", () => {
    const state = overlayStateFromData(data, new Set(), ["p1", "p2"]);
    expect(state.taskLists.map((list) => list.id)).toEqual(["team", "team-b"]);
    expect(state.tasks.map((task) => task.id)).toEqual(["b", "c"]);
  });
});
