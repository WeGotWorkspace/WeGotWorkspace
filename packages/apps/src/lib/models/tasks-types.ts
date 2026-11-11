import type {
  Task,
  TaskAlert,
  TaskCreate,
  TaskImportResponse,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
} from "@wgw/openapi-types/tasks-types";
import type { CollectionSharePrincipal } from "@/lib/sharing/collection-share";

export type {
  Task,
  TaskAlert,
  TaskCreate,
  TaskImportResponse,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
};

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
  /**
   * Fail instead of queueing the write offline: the caller needs the server's
   * answer now (an import into a new list).
   */
  requireServer?: boolean;
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
  /** ICS import into one task list (#1624). Online only. */
  importTasks?: (icsText: string, opts: { taskListId: string }) => Promise<TaskImportResponse>;
};
