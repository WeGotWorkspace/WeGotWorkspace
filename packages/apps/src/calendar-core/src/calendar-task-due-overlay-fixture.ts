import { MOCK_CALENDAR_ANCHOR } from "@/lib/api/mock/calendar-bootstrap";
import { createSharedTasksLists } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TasksUIData } from "@/tasks-core/src/tasks-types";

/** Overlay fixture pinned to the Calendar story anchor so dues paint on every view. */
export function createCalendarTaskDueOverlayFixture(
  anchor: string = MOCK_CALENDAR_ANCHOR,
): TasksUIData {
  const taskLists = createSharedTasksLists();
  const tasks: Task[] = [
    {
      "@type": "Task",
      id: "task-buy-milk",
      taskListId: "default",
      uid: "urn:uuid:overlay-milk",
      title: "Buy milk",
      due: anchor,
      showWithoutTime: true,
      workflowStatus: "needs-action",
      isDraft: false,
      sortOrder: 0,
      categories: ["errands"],
    },
    {
      "@type": "Task",
      id: "task-review-spec",
      taskListId: "work",
      uid: "urn:uuid:overlay-spec",
      title: "Review API spec",
      due: `${anchor}T14:00:00`,
      showWithoutTime: false,
      workflowStatus: "in-process",
      isDraft: false,
      sortOrder: 1,
      categories: ["work"],
    },
    {
      "@type": "Task",
      id: "task-shared-due",
      taskListId: "shared-inbox",
      uid: "urn:uuid:overlay-shared",
      title: "Shared due",
      due: anchor,
      showWithoutTime: true,
      workflowStatus: "needs-action",
      isDraft: false,
      sortOrder: 0,
      categories: [],
    },
    {
      "@type": "Task",
      id: "task-completed-due",
      taskListId: "default",
      uid: "urn:uuid:overlay-done",
      title: "Completed due",
      due: anchor,
      showWithoutTime: true,
      workflowStatus: "completed",
      isDraft: false,
      sortOrder: 9,
      categories: [],
    },
  ];
  return { taskLists, tasks };
}
