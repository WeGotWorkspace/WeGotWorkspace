import type { Dispatch, SetStateAction } from "react";
import type { CompletedWriteKeys } from "@/hooks/use-queued-mutation";
import type { Task, TasksAPIOperations } from "@/tasks-core/src/tasks-types";

type SetTasks = Dispatch<SetStateAction<Task[]>>;

function showServerTask(setTasks: SetTasks, saved: Task): void {
  setTasks((prev) => prev.map((task) => (task.id === saved.id ? saved : task)));
}

/** Moves tasks one at a time and marks each move the server applied. */
export async function moveTasksToList(
  operations: TasksAPIOperations,
  tasks: readonly Task[],
  listId: string,
  signal: AbortSignal,
  markCompleted: (taskId: string) => void,
): Promise<void> {
  for (const task of tasks) {
    await operations.moveTaskToList(task.id, listId, { signal });
    markCompleted(task.id);
  }
}

/** Undo of a move: each task the server moved goes back to the list it came from. */
export async function moveTasksBack(
  operations: TasksAPIOperations,
  setTasks: SetTasks,
  before: readonly Task[],
  completed: CompletedWriteKeys,
): Promise<void> {
  for (const task of before) {
    if (completed && !completed.has(task.id)) continue;
    showServerTask(setTasks, await operations.moveTaskToList(task.id, task.taskListId));
  }
}
