import type {
  Task,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
  TaskTaskListListResponse,
} from "@wgw/openapi-types/tasks-types";
import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { TaskProjectGroupOption } from "@/tasks-core/src/tasks-types";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";

export class TasksRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type TasksRequestOpts = {
  signal?: AbortSignal;
  ifMatch?: string;
};

async function requestTasksJson(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  opts?: TasksRequestOpts,
): Promise<unknown> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (opts?.ifMatch) {
    headers.set("If-Match", opts.ifMatch);
  }

  const init: RequestInit = { method, signal: opts?.signal, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await wgwFetch(path, init);
  if (!res.ok) {
    throw new TasksRequestError(`${method} ${path} failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined;
  return wgwReadJson(res);
}

function parseTaskLists(json: unknown): TaskList[] {
  if (!json || typeof json !== "object") return [];
  const payload = json as TaskTaskListListResponse | Record<string, unknown>;
  const list = "list" in payload && Array.isArray(payload.list) ? payload.list : [];
  return list as TaskList[];
}

function parseTasks(json: unknown): Task[] {
  if (!json || typeof json !== "object") return [];
  const payload = json as { list?: Task[] };
  return Array.isArray(payload.list) ? payload.list : [];
}

export async function listTaskLists(opts?: { signal?: AbortSignal }): Promise<TaskList[]> {
  const json = await requestTasksJson("/tasks/tasklists", "GET", undefined, opts);
  return parseTaskLists(json);
}

export async function listTasks(opts: {
  taskListId: string;
  signal?: AbortSignal;
}): Promise<Task[]> {
  const query = `?taskListId=${encodeURIComponent(opts.taskListId)}`;
  const json = await requestTasksJson(`/tasks/items${query}`, "GET", undefined, opts);
  return parseTasks(json);
}

export async function getTask(taskId: string, opts?: { signal?: AbortSignal }): Promise<Task> {
  const json = await requestTasksJson(
    `/tasks/items/${encodeURIComponent(taskId)}`,
    "GET",
    undefined,
    opts,
  );
  return json as Task;
}

export async function createTask(body: TaskCreate, opts?: TasksRequestOpts): Promise<Task> {
  const json = await requestTasksJson("/tasks/items", "POST", body, opts);
  return json as Task;
}

export async function patchTask(
  taskId: string,
  patch: TaskPatch,
  opts?: TasksRequestOpts,
): Promise<Task> {
  const json = await requestTasksJson(
    `/tasks/items/${encodeURIComponent(taskId)}`,
    "PATCH",
    patch,
    opts,
  );
  return json as Task;
}

export async function putTask(
  taskId: string,
  body: TaskCreate,
  opts?: TasksRequestOpts,
): Promise<Task> {
  const json = await requestTasksJson(
    `/tasks/items/${encodeURIComponent(taskId)}`,
    "PUT",
    body,
    opts,
  );
  return json as Task;
}

export async function deleteTask(taskId: string, opts?: TasksRequestOpts): Promise<void> {
  await requestTasksJson(`/tasks/items/${encodeURIComponent(taskId)}`, "DELETE", undefined, opts);
}

export async function createTaskList(
  body: TaskListCreate,
  opts?: TasksRequestOpts,
): Promise<TaskList> {
  const json = await requestTasksJson("/tasks/tasklists", "POST", body, opts);
  return json as TaskList;
}

export async function patchTaskList(
  taskListId: string,
  patch: TaskListPatch,
  opts?: TasksRequestOpts,
): Promise<TaskList> {
  const json = await requestTasksJson(
    `/tasks/tasklists/${encodeURIComponent(taskListId)}`,
    "PATCH",
    patch,
    opts,
  );
  return json as TaskList;
}

export async function deleteTaskList(
  taskListId: string,
  opts?: TasksRequestOpts & { onDestroyRemoveContents?: boolean },
): Promise<void> {
  const body =
    opts?.onDestroyRemoveContents === true ? { onDestroyRemoveContents: true } : undefined;
  await requestTasksJson(
    `/tasks/tasklists/${encodeURIComponent(taskListId)}`,
    "DELETE",
    body,
    opts,
  );
}

export function mapTaskProjectGroups(
  groups: { id: string; displayName: string }[],
): TaskProjectGroupOption[] {
  return groups.map((group) => {
    const prefix = "principals/groups/";
    const slug = group.id.startsWith(prefix) ? group.id.slice(prefix.length) : group.id;
    return {
      slug,
      displayName: group.displayName?.trim() || slug,
    };
  });
}

export async function fetchTasksLiveBootstrap(): Promise<TasksAppBootstrap> {
  const session = await wgwFetchPrincipal();

  const settingsRes = await wgwFetch("/settings/state");
  let groups: TaskProjectGroupOption[] = [];
  if (settingsRes.ok) {
    const settings = (await wgwReadJson(settingsRes)) as {
      apps?: { tasks?: boolean };
      groups?: { id: string; displayName: string }[];
    };
    if (settings.apps?.tasks === false) {
      throw new Error("TASKS_SETTINGS_MISSING");
    }
    if (Array.isArray(settings.groups)) {
      groups = mapTaskProjectGroups(settings.groups);
    }
  }

  const taskLists = await listTaskLists();
  const taskListsResults = await Promise.all(
    taskLists.map((list) => listTasks({ taskListId: list.id })),
  );
  const tasks = taskListsResults.flat();

  return {
    data: { taskLists, tasks, groups },
    session,
  };
}
