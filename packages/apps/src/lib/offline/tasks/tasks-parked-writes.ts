import type { Task, TaskCreate, TaskList, TaskListCreate } from "@wgw/openapi-types/tasks-types";
import { parkWrites, type ParkedWrite } from "@/lib/offline/core/parked-writes";
import type { RescueOperations } from "@/lib/offline/core/rescue-parked-writes";
import { taskCreateFromTask } from "@/lib/offline/tasks/tasks-patch-merge";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

/** A refused task write waiting for a list (see `ParkedWrite`); `item` is the local task. */
export type ParkedTask = ParkedWrite<Task>;

/** The task operations a rescue needs; the Tasks hybrid operations fit. */
export type TaskRescueOperations = {
  createTask: (body: TaskCreate) => Promise<Task>;
  createTaskList?: (body: TaskListCreate) => Promise<TaskList>;
};

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

/** Tasks' part of the shared rescue: make a list, and create a parked task anew in one. */
export function tasksRescueOperations(operations: TaskRescueOperations): RescueOperations<Task> {
  return {
    createContainer: operations.createTaskList
      ? (name) => operations.createTaskList!({ name })
      : undefined,
    createItemIn: (taskListId, task) => operations.createTask(rescueBody(task, taskListId)),
  };
}
