import type {
  Task,
  TaskAlert,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
} from "@wgw-api-generated/tasks-types";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

export type { Task, TaskAlert, TaskCreate, TaskList, TaskListCreate, TaskListPatch, TaskPatch };

export type TaskProjectGroupOption = {
  slug: string;
  displayName: string;
};

export type TasksUIData = {
  taskLists: TaskList[];
  tasks: Task[];
  groups?: TaskProjectGroupOption[];
};

export type TasksMutationOpts = {
  signal?: AbortSignal;
  ifMatch?: string;
};

/**
 * Backend-agnostic task operations consumed by tasks UI/controller.
 */
export type TasksAPIOperations = {
  createTask: (body: TaskCreate, opts?: TasksMutationOpts) => Promise<Task>;
  patchTask: (taskId: string, patch: TaskPatch, opts?: TasksMutationOpts) => Promise<Task>;
  deleteTask: (taskId: string, opts?: TasksMutationOpts) => Promise<void>;
  moveTaskToList: (taskId: string, taskListId: string, opts?: TasksMutationOpts) => Promise<Task>;
  createTaskList?: (body: TaskListCreate, opts?: TasksMutationOpts) => Promise<TaskList>;
  patchTaskList?: (
    taskListId: string,
    patch: TaskListPatch,
    opts?: TasksMutationOpts,
  ) => Promise<TaskList>;
  deleteTaskList?: (
    taskListId: string,
    opts?: TasksMutationOpts & { onDestroyRemoveContents?: boolean },
  ) => Promise<void>;
  searchSharePrincipals?: (query: string) => Promise<CollectionSharePrincipal[]>;
};
