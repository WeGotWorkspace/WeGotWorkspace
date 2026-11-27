import type { TeamOwnerOption } from "@/lib/sharing/team-owner-options";
import type {
  Task,
  TaskAlert,
  TaskCreate,
  TaskImportResponse,
  TaskList,
  TaskListCreate,
  TaskListMember,
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
  TaskListMember,
  TaskListPatch,
  TaskPatch,
};

export type TaskProjectGroupOption = TeamOwnerOption;

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

export type TaskListMembersResult = {
  /** Null when there is no answer: offline and never loaded online. */
  members: TaskListMember[] | null;
  /** True when the answer came from the offline cache. */
  fromCache: boolean;
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
  /**
   * The people of a task list for the assignee picker (#2172). Online it asks
   * the server and caches the answer; offline it returns the cached answer,
   * or `members: null` for a list never opened online.
   */
  listTaskListMembers?: (taskListId: string) => Promise<TaskListMembersResult>;
  /** ICS import into one task list (#1624). Online only. */
  importTasks?: (icsText: string, opts: { taskListId: string }) => Promise<TaskImportResponse>;
};
