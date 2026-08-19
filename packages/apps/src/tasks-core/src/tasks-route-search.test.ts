import { describe, expect, it } from "vitest";
import {
  isTasksPathname,
  normalizeTasksView,
  tasksNavigateTarget,
  tasksViewFromLocation,
} from "@/tasks-core/src/tasks-route-search";
import { INBOX_TASK_LIST_ID } from "@/tasks-core/src/tasks-task-utils";

describe("tasks-route-search", () => {
  it("recognizes only the tasks app prefix", () => {
    expect(isTasksPathname("/tasks")).toBe(true);
    expect(isTasksPathname("/tasks/state/today")).toBe(true);
    expect(isTasksPathname("/tasks/lists/inbox")).toBe(true);
    expect(isTasksPathname("/calendar")).toBe(false);
    expect(isTasksPathname("/contacts")).toBe(false);
    expect(isTasksPathname("/task")).toBe(false);
  });

  it("maps state and list paths to controller view keys", () => {
    expect(tasksViewFromLocation("/tasks/state/all", {})).toBe("state:all");
    expect(tasksViewFromLocation("/tasks/state/today", { stateSlug: "today" })).toBe("state:today");
    expect(
      tasksViewFromLocation("/tasks/lists/work", {
        listId: "work",
      }),
    ).toBe("list:work");
  });

  it("redirects legacy tag paths to the inbox view", () => {
    expect(tasksViewFromLocation("/tasks/tags/focus", {})).toBe("list:inbox");
    expect(tasksViewFromLocation("/tasks/tags/My%20Tag", {})).toBe("list:inbox");
  });

  it("prefers pathname slugs when route params are not yet available", () => {
    expect(tasksViewFromLocation("/tasks/state/all", {})).toBe("state:all");
    expect(tasksViewFromLocation("/tasks/lists/inbox", {})).toBe("list:inbox");
  });

  it("maps priority paths to controller view keys", () => {
    expect(tasksViewFromLocation("/tasks/priority/high", { prioritySlug: "high" })).toBe(
      "priority:high",
    );
    expect(tasksViewFromLocation("/tasks/priority/medium", {})).toBe("priority:medium");
    expect(tasksViewFromLocation("/tasks/priority/low", {})).toBe("priority:low");
  });

  it("builds navigation targets from controller view state", () => {
    expect(tasksNavigateTarget("state:all")).toEqual({ to: "/tasks/state/all", params: {} });
    expect(tasksNavigateTarget("state:today")).toEqual({
      to: "/tasks/state/$stateSlug",
      params: { stateSlug: "today" },
    });
    expect(tasksNavigateTarget("tag:work")).toEqual({
      to: "/tasks/lists/$listId",
      params: { listId: "inbox" },
    });
    expect(tasksNavigateTarget("list:personal")).toEqual({
      to: "/tasks/lists/$listId",
      params: { listId: "personal" },
    });
    expect(tasksNavigateTarget("priority:high")).toEqual({
      to: "/tasks/priority/$prioritySlug",
      params: { prioritySlug: "high" },
    });
  });

  it("normalizes inbox aliases to the canonical list id from bootstrap", () => {
    const taskLists = [
      { id: "tl-inbox-uuid", role: "inbox", name: "Inbox" },
      { id: "work", name: "Work" },
    ];

    expect(normalizeTasksView(`list:${INBOX_TASK_LIST_ID}`, taskLists)).toBe("list:tl-inbox-uuid");
    expect(normalizeTasksView("list:tl-inbox-uuid", taskLists)).toBe("list:tl-inbox-uuid");
    expect(normalizeTasksView("list:work", taskLists)).toBe("list:work");
    expect(normalizeTasksView("state:today", taskLists)).toBe("state:today");
    expect(normalizeTasksView("tag:work", taskLists)).toBe("list:tl-inbox-uuid");
  });
});
