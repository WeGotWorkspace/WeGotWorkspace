import type { Task, TaskList } from "@wgw-api-generated/tasks-types";
import type { TasksUIData } from "@/tasks-core/src/tasks-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { mapTaskProjectGroups } from "@/lib/api/wgw/tasks";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";

export type TasksAppBootstrap = {
  data: TasksUIData;
  session: WorkspaceSession;
};

const fullRights: TaskList["myRights"] = {
  mayReadItems: true,
  mayWriteAll: true,
  mayWriteOwn: true,
  mayUpdatePrivate: true,
  mayRSVP: true,
  mayAdmin: true,
  mayDelete: true,
};

const mockTaskLists: TaskList[] = [
  {
    id: "inbox",
    role: "inbox",
    name: "Inbox",
    description: null,
    sortOrder: 0,
    isDefault: true,
    isSubscribed: true,
    shareWith: null,
    myRights: fullRights,
    scope: "personal",
    groupSlug: null,
  },
  {
    id: "default",
    name: "Personal",
    description: null,
    color: "#6366f1",
    sortOrder: 1,
    isDefault: false,
    isSubscribed: true,
    shareWith: null,
    myRights: fullRights,
    scope: "personal",
    groupSlug: null,
  },
  {
    id: "work",
    name: "Work",
    description: null,
    color: "#f59e0b",
    sortOrder: 2,
    isDefault: false,
    isSubscribed: true,
    shareWith: null,
    myRights: fullRights,
    scope: "personal",
    groupSlug: null,
  },
];

const mockTasks: Task[] = [
  {
    "@type": "Task",
    id: "task-inbox-demo",
    taskListId: "inbox",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
    title: "Quick capture",
    description: "Default inbox task",
    workflowStatus: "needs-action",
    isDraft: false,
    sortOrder: 0,
    categories: [],
    alerts: undefined,
  },
  {
    "@type": "Task",
    id: "task-buy-milk",
    taskListId: "default",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440001",
    title: "Buy milk",
    description: "2% organic",
    due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 19),
    workflowStatus: "needs-action",
    priority: 5,
    isDraft: false,
    sortOrder: 0,
    categories: ["errands"],
    alerts: undefined,
  },
  {
    "@type": "Task",
    id: "task-review-spec",
    taskListId: "work",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440002",
    title: "Review API spec",
    description: null,
    due: new Date(Date.now() + 172_800_000).toISOString().slice(0, 19),
    workflowStatus: "in-process",
    priority: 1,
    isDraft: false,
    sortOrder: 1,
    categories: ["work", "review"],
    alerts: {
      alert1: {
        "@type": "Alert",
        trigger: { "@type": "OffsetTrigger", offset: "-PT30M", relativeTo: "end" },
        action: "display",
      },
    },
  },
  {
    "@type": "Task",
    id: "task-two-reminders",
    taskListId: "work",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440005",
    title: "Prep launch notes",
    description: null,
    due: new Date(Date.now() + 259_200_000).toISOString().slice(0, 19),
    workflowStatus: "needs-action",
    isDraft: false,
    sortOrder: 4,
    categories: ["work"],
    alerts: {
      alert1: {
        "@type": "Alert",
        trigger: { "@type": "OffsetTrigger", offset: "-PT30M", relativeTo: "end" },
        action: "display",
      },
      alert2: {
        "@type": "Alert",
        trigger: { "@type": "OffsetTrigger", offset: "-PT1H", relativeTo: "end" },
        action: "display",
      },
    },
  },
  {
    "@type": "Task",
    id: "task-overdue",
    taskListId: "default",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440003",
    title: "Overdue example",
    due: new Date(Date.now() - 86_400_000).toISOString().slice(0, 19),
    workflowStatus: "needs-action",
    isDraft: false,
    sortOrder: 2,
    categories: [],
    alerts: undefined,
  },
  {
    "@type": "Task",
    id: "task-done",
    taskListId: "work",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440004",
    title: "Ship v0.9",
    completed: new Date().toISOString().slice(0, 19),
    workflowStatus: "completed",
    isDraft: false,
    sortOrder: 3,
    categories: ["work"],
    alerts: undefined,
  },
];

export function createTasksAppBootstrap(overrides?: Partial<TasksAppBootstrap>): TasksAppBootstrap {
  const settingsBootstrap = createSettingsAppBootstrap();
  return {
    data: {
      taskLists: mockTaskLists,
      tasks: mockTasks,
      groups: mapTaskProjectGroups(settingsBootstrap.data.groups),
    },
    session: mockWorkspaceSession,
    ...overrides,
  };
}
