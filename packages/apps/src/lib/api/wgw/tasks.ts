import type {
  Task,
  TaskCreate,
  TaskImportResponse,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
  TaskTaskListListResponse,
} from "@wgw/openapi-types/tasks-types";
import type { components } from "@wgw/openapi-types/openapi-types";
import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { TaskProjectGroupOption } from "@/tasks-core/src/tasks-types";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import {
  cachedCollectionAudience,
  cachedItemAudience,
  checkNowAfterWrite,
} from "@/lib/offline/core/collection-check-now";

export class TasksRequestError extends Error {
  status: number;
  /** API error code from the JSON body (`{ error, code }`), when there is one. */
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isTasksCannotCalculateChanges(error: unknown): boolean {
  return error instanceof TasksRequestError && error.code === "cannotCalculateChanges";
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
    let code: string | undefined;
    try {
      const errorBody = (await res.json()) as { code?: unknown };
      if (typeof errorBody.code === "string") code = errorBody.code;
    } catch {
      // Status alone is enough when the body is not JSON.
    }
    throw new TasksRequestError(`${method} ${path} failed (${res.status})`, res.status, code);
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

export type TaskListChangesDelta = components["schemas"]["JmapTaskListChangesResponse"];

function parseIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Task lists created, updated or destroyed since `since`. A list counts as
 * updated when any task in it changed. No `since` returns every list as created.
 * Throws `cannotCalculateChanges` (400) when the state is unknown or expired.
 */
export async function listTaskListChanges(
  since?: string | null,
  opts?: { signal?: AbortSignal },
): Promise<TaskListChangesDelta> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const json = (await requestTasksJson(
    `/tasks/tasklists/changes${query}`,
    "GET",
    undefined,
    opts,
  )) as Partial<TaskListChangesDelta> | undefined;
  return {
    oldState: typeof json?.oldState === "string" ? json.oldState : "0",
    newState: typeof json?.newState === "string" ? json.newState : "0",
    created: parseIds(json?.created),
    updated: parseIds(json?.updated),
    destroyed: parseIds(json?.destroyed),
  };
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
  const task = (await requestTasksJson("/tasks/items", "POST", body, opts)) as Task;
  checkNowAfterWrite([cachedCollectionAudience("tasks", [task.taskListId])]);
  return task;
}

export async function patchTask(
  taskId: string,
  patch: TaskPatch,
  opts?: TasksRequestOpts,
): Promise<Task> {
  const before = cachedItemAudience("tasks", taskId);
  const task = (await requestTasksJson(
    `/tasks/items/${encodeURIComponent(taskId)}`,
    "PATCH",
    patch,
    opts,
  )) as Task;
  checkNowAfterWrite([before, cachedCollectionAudience("tasks", [task.taskListId])]);
  return task;
}

export async function putTask(
  taskId: string,
  body: TaskCreate,
  opts?: TasksRequestOpts,
): Promise<Task> {
  const before = cachedItemAudience("tasks", taskId);
  const task = (await requestTasksJson(
    `/tasks/items/${encodeURIComponent(taskId)}`,
    "PUT",
    body,
    opts,
  )) as Task;
  checkNowAfterWrite([before, cachedCollectionAudience("tasks", [task.taskListId])]);
  return task;
}

export async function deleteTask(taskId: string, opts?: TasksRequestOpts): Promise<void> {
  const before = cachedItemAudience("tasks", taskId);
  await requestTasksJson(`/tasks/items/${encodeURIComponent(taskId)}`, "DELETE", undefined, opts);
  checkNowAfterWrite([before]);
}

/**
 * POST /tasks/items/import (#1624). A 400 that carries `list`/`errors` is an
 * import where every task failed (for example all UIDs already exist): it is
 * returned as a result, not thrown, so the person sees each reason.
 */
export async function importTasksLive(
  icsText: string,
  opts: { taskListId: string; signal?: AbortSignal },
): Promise<TaskImportResponse> {
  const path = `/tasks/items/import?taskListId=${encodeURIComponent(opts.taskListId)}`;
  const res = await wgwFetch(path, {
    method: "POST",
    headers: { "Content-Type": "text/calendar" },
    body: icsText,
    signal: opts.signal,
  });
  let body: unknown;
  try {
    body = await wgwReadJson(res);
  } catch {
    body = undefined;
  }
  const result = parseTaskImportResponse(body);
  if (result && (res.ok || res.status === 400)) {
    if (result.list.length > 0) {
      checkNowAfterWrite([cachedCollectionAudience("tasks", [opts.taskListId])]);
    }
    return result;
  }
  const error =
    body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {};
  throw new TasksRequestError(
    typeof error.error === "string" && error.error.trim() !== ""
      ? error.error
      : `POST /tasks/items/import failed (${res.status})`,
    res.status,
    typeof error.code === "string" ? error.code : undefined,
  );
}

function parseTaskImportResponse(body: unknown): TaskImportResponse | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Partial<TaskImportResponse>;
  if (!Array.isArray(value.list) || !Array.isArray(value.errors)) return null;
  const events = value.skipped?.events;
  return {
    list: value.list,
    errors: value.errors,
    skipped: { events: typeof events === "number" ? events : 0 },
  };
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
  const before = cachedCollectionAudience("tasks", [taskListId]);
  const list = (await requestTasksJson(
    `/tasks/tasklists/${encodeURIComponent(taskListId)}`,
    "PATCH",
    patch,
    opts,
  )) as TaskList;
  checkNowAfterWrite([before], list.shareWith);
  return list;
}

export async function deleteTaskList(
  taskListId: string,
  opts?: TasksRequestOpts & { onDestroyRemoveContents?: boolean },
): Promise<void> {
  const body =
    opts?.onDestroyRemoveContents === true ? { onDestroyRemoveContents: true } : undefined;
  const before = cachedCollectionAudience("tasks", [taskListId]);
  await requestTasksJson(
    `/tasks/tasklists/${encodeURIComponent(taskListId)}`,
    "DELETE",
    body,
    opts,
  );
  checkNowAfterWrite([before]);
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
  // Stays undefined when the Teams could not be loaded: not the same as "no Team".
  let groups: TaskProjectGroupOption[] | undefined;
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
