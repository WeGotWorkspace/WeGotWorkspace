import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createSharedTasksAppBootstrap,
  createTasksAppBootstrap,
} from "@/lib/api/mock/tasks-bootstrap";
import type { TasksAPIOperations } from "@/tasks-core/src/tasks-types";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";

const storyOperations: TasksAPIOperations = {
  createTask: async (body) => ({
    "@type": "Task",
    id: "story-task",
    taskListId: Object.keys(body.taskListIds)[0] ?? "inbox",
    uid: "urn:uuid:story-task",
    title: body.title,
    isDraft: false,
    sortOrder: 0,
    categories: [],
  }),
  patchTask: async (taskId, patch) => ({
    "@type": "Task",
    id: taskId,
    taskListId: "inbox",
    uid: "urn:uuid:story-task",
    title: patch.title ?? "Task",
    isDraft: false,
    sortOrder: 0,
    categories: [],
  }),
  deleteTask: async () => undefined,
  moveTaskToList: async (taskId, taskListId) => ({
    "@type": "Task",
    id: taskId,
    taskListId,
    uid: "urn:uuid:story-task",
    title: "Task",
    isDraft: false,
    sortOrder: 0,
    categories: [],
  }),
  createTaskList: async (body) => ({
    id: "story-list",
    name: body.name,
    color: body.color ?? "#6366f1",
    sortOrder: 0,
    isDefault: false,
    isSubscribed: true,
    isSharee: false,
    shareWith: null,
    scope: body.groupSlug ? "group" : "personal",
    groupSlug: body.groupSlug ?? null,
    myRights: {
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayAdmin: true,
      mayDelete: true,
      mayShare: true,
    },
  }),
  patchTaskList: async (taskListId, patch) => ({
    id: taskListId,
    name: patch.name ?? "List",
    color: patch.color ?? "#6366f1",
    sortOrder: 0,
    isDefault: false,
    isSubscribed: true,
    isSharee: false,
    shareWith: patch.shareWith ?? null,
    scope: "personal",
    groupSlug: null,
    myRights: {
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayAdmin: true,
      mayDelete: true,
      mayShare: true,
    },
  }),
  deleteTaskList: async () => undefined,
};

const meta: Meta<typeof TasksWorkspace> = {
  title: "Apps/Tasks",
  component: TasksWorkspace,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    operations: storyOperations,
  },
};

export default meta;
type Story = StoryObj<typeof TasksWorkspace>;

export const Default: Story = {
  args: {
    ...createTasksAppBootstrap(),
  },
};

export const SharedWithMe: Story = {
  args: {
    ...createSharedTasksAppBootstrap(),
  },
};
