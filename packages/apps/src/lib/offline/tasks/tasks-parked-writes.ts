import type { Task, TaskCreate, TaskList, TaskListCreate } from "@wgw/openapi-types/tasks-types";
import { parkWrites, type ParkedWrite } from "@/lib/offline/core/parked-writes";
import { taskCreateFromTask } from "@/lib/offline/tasks/tasks-patch-merge";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

/** A refused task write waiting for a list (see `ParkedWrite`); `item` is the local task. */
export type ParkedTask = ParkedWrite<Task>;

/** Where rescued tasks go: a list the person can write to, or a new list by name. */
export type TaskRescueTarget = { listId: string } | { newListName: string };

/** The task operations a rescue needs; the Tasks hybrid operations fit. */
export type TaskRescueOperations = {
  createTask: (body: TaskCreate) => Promise<Task>;
  createTaskList?: (body: TaskListCreate) => Promise<TaskList>;
};

export class TaskRescueError extends Error {
  constructor(readonly failed: number) {
    super(`Could not move ${failed} rescued task(s)`);
    this.name = "TaskRescueError";
  }
}

export function parkTask(
  username: string,
  task: Task,
  write: Pick<ParkedTask, "kind" | "reason" | "containerName">,
): Promise<void> {
  return parkWrites(username, TASKS_DOMAIN, [
    {
      ...write,
      domain: TASKS_DOMAIN,
      entityId: task.id,
      containerId: task.taskListId,
      title: task.title?.trim() ?? "",
      item: task,
    },
  ]);
}

/** A new task in `taskListId` with the parked task's fields; the server picks a new uid. */
function rescueBody(task: Task, taskListId: string): TaskCreate {
  const { uid: _uid, ...body } = taskCreateFromTask(task, taskListId);
  return body;
}

/**
 * Create each taken write as a new task in the target list (made first when it
 * is new). A task that fails goes back to the park, so nothing is lost.
 */
export async function rescueParkedTasks(
  username: string,
  writes: ParkedTask[],
  target: TaskRescueTarget,
  operations: TaskRescueOperations,
): Promise<{ listId: string }> {
  let listId = "listId" in target ? target.listId : "";
  try {
    if ("newListName" in target) {
      if (!operations.createTaskList) throw new Error("Lists cannot be created here");
      listId = (await operations.createTaskList({ name: target.newListName })).id;
    }
  } catch (error) {
    await parkWrites(username, TASKS_DOMAIN, writes);
    throw error;
  }
  const failed: ParkedTask[] = [];
  for (const write of writes) {
    await operations.createTask(rescueBody(write.item, listId)).catch(() => failed.push(write));
  }
  if (failed.length > 0) {
    await parkWrites(username, TASKS_DOMAIN, failed);
    throw new TaskRescueError(failed.length);
  }
  return { listId };
}
