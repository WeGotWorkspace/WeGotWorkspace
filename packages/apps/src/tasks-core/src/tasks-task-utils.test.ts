import { describe, expect, it } from "vitest";
import {
  composerDefaultDueForView,
  defaultTaskListId,
  filterTasksByView,
  formatComposerDueDateLabel,
  INBOX_TASK_LIST_ID,
  isProtectedTaskList,
  mergeCreatedTask,
  offsetReminderAlert,
  taskAlertsEqual,
  taskAlertsFromList,
  taskListDotColor,
} from "./tasks-task-utils";
import { defaultTasksLabels } from "./tasks-labels";
import type { Task } from "./tasks-types";

const sampleTasks: Task[] = [
  {
    "@type": "Task",
    id: "t1",
    taskListId: "default",
    uid: "u1",
    title: "High priority",
    priority: 1,
    isDraft: false,
    sortOrder: 0,
    categories: [],
  },
  {
    "@type": "Task",
    id: "t2",
    taskListId: "default",
    uid: "u2",
    title: "Medium priority",
    priority: 5,
    isDraft: false,
    sortOrder: 1,
    categories: [],
  },
  {
    "@type": "Task",
    id: "t3",
    taskListId: "default",
    uid: "u3",
    title: "No priority",
    priority: null,
    isDraft: false,
    sortOrder: 2,
    categories: [],
  },
];

describe("tasks-task-utils", () => {
  it("isProtectedTaskList guards only inbox lists", () => {
    expect(isProtectedTaskList({ id: "inbox", role: "inbox", name: "Inbox" })).toBe(true);
    expect(isProtectedTaskList({ id: "tl-inbox-uuid", role: "inbox", name: "Inbox" })).toBe(true);
    expect(isProtectedTaskList({ id: "tasks-home", role: "home", name: "Home" })).toBe(false);
    expect(isProtectedTaskList({ id: "tasks-work", role: "work", name: "Work" })).toBe(false);
    expect(isProtectedTaskList({ id: "group-team", role: "group", name: "Team" })).toBe(false);
    expect(isProtectedTaskList({ id: "custom", role: null, name: "Custom" })).toBe(false);
  });

  it("defaultTaskListId prefers inbox over other lists", () => {
    expect(
      defaultTaskListId([
        { id: "work", name: "Work", isDefault: false },
        { id: INBOX_TASK_LIST_ID, role: "inbox", name: "Inbox", isDefault: true },
      ]),
    ).toBe(INBOX_TASK_LIST_ID);
  });

  it("defaultTaskListId falls back to isDefault then first list", () => {
    expect(
      defaultTaskListId([
        { id: "work", isDefault: false },
        { id: "personal", isDefault: true },
      ]),
    ).toBe("personal");
    expect(defaultTaskListId([{ id: "work", isDefault: false }])).toBe("work");
    expect(defaultTaskListId([])).toBe(INBOX_TASK_LIST_ID);
  });

  it("taskListDotColor prefers explicit list color over hash fallback", () => {
    expect(taskListDotColor({ id: "work", color: "#ff0000" })).toBe("#ff0000");
    expect(taskListDotColor({ id: "work", color: "  #22c55e  " })).toBe("#22c55e");
  });

  it("taskListDotColor falls back to deterministic hash from list id", () => {
    expect(taskListDotColor("work")).toBe(taskListDotColor({ id: "work", color: null }));
    expect(taskListDotColor({ id: "work" })).toBe(taskListDotColor("work"));
  });

  it("filterTasksByView filters by priority slug", () => {
    expect(filterTasksByView(sampleTasks, "priority:high").map((task) => task.id)).toEqual(["t1"]);
    expect(filterTasksByView(sampleTasks, "priority:medium").map((task) => task.id)).toEqual([
      "t2",
    ]);
    expect(filterTasksByView(sampleTasks, "priority:low")).toEqual([]);
  });

  it("filterTasksByView matches legacy inverted API priority values", () => {
    const legacyHigh = { ...sampleTasks[0], id: "legacy-high", priority: 10 };
    expect(filterTasksByView([legacyHigh], "priority:high").map((task) => task.id)).toEqual([
      "legacy-high",
    ]);
  });

  it("mergeCreatedTask keeps optimistic priority when API response omits it", () => {
    const optimistic = {
      ...sampleTasks[0],
      id: "pending-1",
      priority: 1,
      workflowStatus: "in-process" as const,
    };
    const created = {
      ...sampleTasks[0],
      id: "task-created",
      priority: null,
      workflowStatus: undefined,
    };

    expect(mergeCreatedTask(optimistic, created)).toMatchObject({
      id: "task-created",
      priority: 1,
      workflowStatus: "in-process",
    });
  });

  it("mergeCreatedTask uses API priority when response includes it", () => {
    const optimistic = {
      ...sampleTasks[0],
      id: "pending-1",
      priority: 1,
    };
    const created = {
      ...sampleTasks[0],
      id: "task-created",
      priority: 5,
    };

    expect(mergeCreatedTask(optimistic, created).priority).toBe(5);
  });

  it("mergeCreatedTask keeps optimistic due when API response omits it", () => {
    const optimisticDue = "2026-07-08T00:00:00";
    const optimistic = {
      ...sampleTasks[0],
      id: "pending-1",
      due: optimisticDue,
      priority: 1,
    };
    const created = {
      ...sampleTasks[0],
      id: "task-created",
      due: null,
      priority: null,
    };

    expect(mergeCreatedTask(optimistic, created)).toMatchObject({
      id: "task-created",
      due: optimisticDue,
      priority: 1,
    });
  });

  it("mergeCreatedTask uses API due when response includes it", () => {
    const optimistic = {
      ...sampleTasks[0],
      id: "pending-1",
      due: "2026-07-08T00:00:00",
    };
    const created = {
      ...sampleTasks[0],
      id: "task-created",
      due: "2026-07-15T00:00:00",
    };

    expect(mergeCreatedTask(optimistic, created).due).toBe("2026-07-15T00:00:00");
  });

  it("formatComposerDueDateLabel shows relative labels for today, yesterday, and tomorrow", () => {
    const now = new Date(2026, 6, 8, 12, 0, 0);
    const labels = {
      dueToday: defaultTasksLabels.dueToday,
      dueYesterday: defaultTasksLabels.dueYesterday,
      dueTomorrow: defaultTasksLabels.dueTomorrow,
    };

    expect(formatComposerDueDateLabel(new Date(2026, 6, 8), labels, now)).toBe("Today");
    expect(formatComposerDueDateLabel(new Date(2026, 6, 7), labels, now)).toBe("Yesterday");
    expect(formatComposerDueDateLabel(new Date(2026, 6, 9), labels, now)).toBe("Tomorrow");
    expect(formatComposerDueDateLabel(new Date(2026, 6, 15), labels, now)).toBe("Jul 15, 2026");
  });

  it("treats empty and missing alerts as equal and distinguishes maps", () => {
    const thirty = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    expect(taskAlertsEqual(undefined, null)).toBe(true);
    expect(taskAlertsEqual(thirty, thirty)).toBe(true);
    expect(taskAlertsEqual(thirty, taskAlertsFromList([offsetReminderAlert("-PT1H")]))).toBe(false);
  });

  it("returns composer default due dates for time-filter views", () => {
    const now = new Date(2026, 6, 8, 12, 0, 0);

    expect(composerDefaultDueForView("state:today", now)).toBe("2026-07-08T00:00:00");
    expect(composerDefaultDueForView("state:upcoming", now)).toBe("2026-07-09T00:00:00");
    expect(composerDefaultDueForView("state:overdue", now)).toBeNull();
    expect(composerDefaultDueForView("state:all", now)).toBeNull();
  });
});
