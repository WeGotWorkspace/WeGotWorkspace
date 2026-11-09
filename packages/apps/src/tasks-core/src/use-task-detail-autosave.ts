import { useCallback, useRef } from "react";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import type { TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { taskAlertsPatch } from "@/tasks-core/src/tasks-alert-mapping";
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from "@/tasks-core/src/tasks-priority";
import {
  canWriteTaskList,
  dueEditSendsShowWithoutTime,
  taskAlertsEqual,
} from "@/tasks-core/src/tasks-task-utils";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";

function taskEditValues(input: TasksTaskFormValue) {
  const due = input.due ?? null;
  return {
    title: input.title.trim(),
    description: input.description.trim() || null,
    workflowStatus: input.workflowStatus ?? "needs-action",
    priority: input.priority === TASK_PRIORITY_NONE ? null : input.priority,
    due,
    showWithoutTime: due ? (input.showWithoutTime ?? true) : undefined,
    timeZone: due && input.showWithoutTime === false ? (input.timeZone ?? null) : null,
    alerts: input.alerts,
  };
}

function taskEditPatch(task: Task, next: ReturnType<typeof taskEditValues>): TaskPatch {
  const patch: TaskPatch = {};
  if (next.title !== (task.title ?? "")) patch.title = next.title;
  if (next.description !== (task.description?.trim() || null)) {
    patch.description = next.description;
  }
  if (next.due !== (task.due ?? null)) patch.due = next.due;
  if (dueEditSendsShowWithoutTime(task, next.due, next.showWithoutTime)) {
    patch.showWithoutTime = next.showWithoutTime;
  }
  if (next.due && next.timeZone !== (task.timeZone ?? null)) patch.timeZone = next.timeZone;
  if (!next.due && (task.due ?? null) !== null) {
    patch.due = null;
    patch.showWithoutTime = true;
    patch.timeZone = null;
  }
  if (next.workflowStatus !== (task.workflowStatus ?? "needs-action")) {
    patch.workflowStatus = next.workflowStatus;
  }
  if (next.priority !== normalizeTaskPriority(task.priority)) patch.priority = next.priority;
  if (!taskAlertsEqual(next.alerts, task.alerts)) {
    patch.alerts = taskAlertsPatch(task.alerts, next.alerts);
  }
  return patch;
}

type UseTaskDetailAutosaveArgs = Pick<
  TasksShellState,
  "tasks" | "taskLists" | "setTasks" | "operations" | "showMutationError"
> & {
  patchTask: (
    taskId: string,
    patch: TaskPatch,
    opts?: { signal?: AbortSignal; ifMatch?: string },
  ) => Promise<Task | undefined>;
};

/**
 * Detail pane autosave. Saves of one task run one after the other, each against
 * the version the previous one produced, or the server refuses the second as a
 * conflict. No toast and the pane stays open (like Notes).
 */
export function useTaskDetailAutosave({
  tasks,
  taskLists,
  setTasks,
  operations,
  patchTask,
  showMutationError,
}: UseTaskDetailAutosaveArgs) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const taskListsRef = useRef(taskLists);
  taskListsRef.current = taskLists;
  const savedEtagsRef = useRef(new Map<string, string>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());

  const saveTaskNow = useCallback(
    async (taskId: string, input: TasksTaskFormValue) => {
      if (!operations) return;
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;
      const lists = taskListsRef.current;
      if (!canWriteTaskList(lists.find((list) => list.id === task.taskListId))) return;
      // A blank title keeps the stored one: a task always has a title.
      const title = input.title.trim() || task.title || "";
      if (!title) return;

      const next = taskEditValues({ ...input, title });
      const listChanged = input.listId !== task.taskListId;
      const patch = taskEditPatch(task, next);
      const hasPatch = Object.keys(patch).length > 0;
      if (!hasPatch && !listChanged) return;

      const snapshot = task;
      const optimistic: Task = { ...task, ...next, taskListId: input.listId };
      tasksRef.current = tasksRef.current.map((item) => (item.id === taskId ? optimistic : item));
      setTasks((prev) => prev.map((item) => (item.id === taskId ? optimistic : item)));

      let rollback: Task = snapshot;
      try {
        let etag = savedEtagsRef.current.get(taskId) ?? (task as Task & { etag?: string }).etag;
        if (listChanged) {
          // Same as the edit dialog: the move carries no precondition (#1814).
          const moved = await operations.moveTaskToList(taskId, input.listId);
          if (moved) {
            rollback = moved;
            etag = (moved as Task & { etag?: string }).etag;
          }
        }
        if (hasPatch) {
          const updated = await patchTask(taskId, patch, { ifMatch: etag });
          etag = (updated as (Task & { etag?: string }) | undefined)?.etag ?? etag;
        }
        if (etag) savedEtagsRef.current.set(taskId, etag);
      } catch {
        setTasks((prev) => prev.map((item) => (item.id === taskId ? rollback : item)));
        showMutationError();
      }
    },
    [operations, patchTask, setTasks, showMutationError],
  );

  const autosaveTask = useCallback(
    (taskId: string, input: TasksTaskFormValue): Promise<void> => {
      const chains = saveChainsRef.current;
      const run = (chains.get(taskId) ?? Promise.resolve()).then(() => saveTaskNow(taskId, input));
      const settled = run.catch(() => {});
      chains.set(taskId, settled);
      void settled.then(() => {
        // Idle again: later saves read the etag from the task (it may have synced).
        if (chains.get(taskId) !== settled) return;
        chains.delete(taskId);
        savedEtagsRef.current.delete(taskId);
      });
      return run;
    },
    [saveTaskNow],
  );

  return autosaveTask;
}
