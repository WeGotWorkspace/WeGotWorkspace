import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import type { TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from "@/tasks-core/src/tasks-priority";
import {
  canWriteTaskList,
  dueEditSendsShowWithoutTime,
  isTaskCompleted,
  mergeCreatedTask,
  shouldHideCompletedTaskAfterExit,
  taskAlertsEqual,
  taskListName,
} from "@/tasks-core/src/tasks-task-utils";
import {
  tasksCompleteToastMessage,
  tasksMoveToastMessage,
} from "@/tasks-core/src/tasks-toast-messages";
import {
  moveTasksBack,
  moveTasksToList,
  revertTaskStatus,
} from "@/tasks-core/src/tasks-undo-writes";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";
import type { TasksExitAnimationState } from "@/tasks-core/src/use-tasks-exit-animation";
import type { TasksListState } from "@/tasks-core/src/use-tasks-list";

/** The task open in the detail pane. */
export type OpenTaskState = null | { taskId: string };

type UseTasksMutationsArgs = {
  shell: TasksShellState;
  list: TasksListState;
  exitAnimation: TasksExitAnimationState;
};

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
  if (!taskAlertsEqual(next.alerts, task.alerts)) patch.alerts = next.alerts ?? null;
  return patch;
}

export function useTasksMutations({ shell, list, exitAnimation }: UseTasksMutationsArgs) {
  const {
    L,
    tasks,
    setTasks,
    taskLists,
    operations,
    showMutationError,
    view,
    ensureTaskListVisible,
  } = shell;
  const { queueMutation } = list;
  const { beginTaskExit, cancelTaskExit } = exitAnimation;

  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "tasks-dialog-surface",
  });
  const [editDialog, setEditDialog] = useState<OpenTaskState>(null);

  const patchTask = useCallback(
    async (taskId: string, patch: TaskPatch, opts?: { signal?: AbortSignal; ifMatch?: string }) => {
      if (!operations) return undefined;
      const existing = tasks.find((task) => task.id === taskId);
      const etag = opts?.ifMatch ?? (existing as Task & { etag?: string })?.etag;
      const updated = await operations.patchTask(taskId, patch, {
        ifMatch: etag,
        signal: opts?.signal,
      });
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updated : task)));
      return updated;
    },
    [operations, setTasks, tasks],
  );

  const createTaskFromForm = useCallback(
    async ({
      title,
      description,
      listId,
      workflowStatus,
      priority,
      due,
      showWithoutTime,
      timeZone,
      alerts,
    }: TasksTaskFormValue) => {
      if (!operations || !title.trim()) return;
      const targetList = taskLists.find((list) => list.id === listId);
      if (!canWriteTaskList(targetList)) return;
      ensureTaskListVisible(listId);
      const trimmedTitle = title.trim();
      const trimmedDescription = description.trim() || null;
      const status = workflowStatus ?? "needs-action";
      const taskPriority = priority === TASK_PRIORITY_NONE ? null : priority;
      const taskDue = due ?? null;
      const taskShowWithoutTime = taskDue ? (showWithoutTime ?? true) : undefined;
      const taskTimeZone = taskDue && showWithoutTime === false ? (timeZone ?? null) : null;
      const taskAlerts = alerts;
      const tempId = `pending-${crypto.randomUUID()}`;
      const optimistic: Task = {
        "@type": "Task",
        id: tempId,
        taskListId: listId,
        uid: tempId,
        title: trimmedTitle,
        description: trimmedDescription,
        due: taskDue,
        showWithoutTime: taskShowWithoutTime,
        timeZone: taskTimeZone,
        workflowStatus: status,
        priority: taskPriority,
        isDraft: false,
        sortOrder: Number.MAX_SAFE_INTEGER,
        categories: [],
        alerts: taskAlerts,
      };

      setTasks((prev) => [...prev, optimistic]);

      try {
        const created = await operations.createTask({
          title: trimmedTitle,
          description: trimmedDescription,
          taskListIds: { [listId]: true },
          workflowStatus: status,
          priority: taskPriority,
          due: taskDue,
          ...(taskDue
            ? {
                showWithoutTime: taskShowWithoutTime,
                timeZone: taskTimeZone,
              }
            : {}),
          alerts: taskAlerts,
        });
        setTasks((prev) =>
          prev.map((task) => (task.id === tempId ? mergeCreatedTask(optimistic, created) : task)),
        );
        shell.show(L.toastTaskAdded, { icon: <Plus className="size-4" /> });
      } catch {
        setTasks((prev) => prev.filter((task) => task.id !== tempId));
        showMutationError();
      }
    },
    [L.toastTaskAdded, operations, setTasks, shell, showMutationError, taskLists],
  );

  const toggleTaskComplete = useCallback(
    (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (!task || !operations) return;
      if (!canWriteTaskList(taskLists.find((list) => list.id === task.taskListId))) return;

      const beforeStatus = task.workflowStatus ?? "needs-action";
      const completing = !isTaskCompleted(task);
      const nextStatus = completing ? "completed" : "needs-action";
      const toastMessage = tasksCompleteToastMessage(completing, L);

      if (completing) {
        beginTaskExit(taskId);
      } else {
        cancelTaskExit(taskId);
      }

      setTasks((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, workflowStatus: nextStatus } : item)),
      );

      const rollback = () => {
        cancelTaskExit(taskId);
        setTasks((prev) =>
          prev.map((item) =>
            item.id === taskId ? { ...item, workflowStatus: beforeStatus } : item,
          ),
        );
      };

      queueMutation({
        key: `tasks:complete:${taskId}`,
        toastMessage,
        icon: completing ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />,
        execute: async (signal) => {
          await patchTask(taskId, { workflowStatus: nextStatus }, { signal });
        },
        revert: () => revertTaskStatus(operations, setTasks, taskId, beforeStatus),
        undo: rollback,
        undoToastMessage: L.toastCompleteUndone,
      });
    },
    [
      L,
      beginTaskExit,
      cancelTaskExit,
      operations,
      patchTask,
      queueMutation,
      setTasks,
      taskLists,
      tasks,
    ],
  );

  const editTask = useCallback((taskId: string) => {
    setEditDialog({ taskId });
  }, []);

  const closeEditTask = useCallback(() => {
    setEditDialog(null);
  }, []);

  const editingTask = useMemo(() => {
    if (!editDialog) return null;
    return tasks.find((item) => item.id === editDialog.taskId) ?? null;
  }, [editDialog, tasks]);

  // Detail pane autosave. Saves of one task run one after the other, each against
  // the version the previous one produced, or the server refuses the second as a
  // conflict. No toast and the pane stays open (like Notes).
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

  const deleteTasks = useCallback(
    (ids: string[]) => {
      if (!operations || ids.length === 0) return;
      const removed = tasks.filter((task) => {
        if (!ids.includes(task.id)) return false;
        return canWriteTaskList(taskLists.find((list) => list.id === task.taskListId));
      });
      if (removed.length === 0) return;

      setTasks((prev) => prev.filter((task) => !ids.includes(task.id)));
      for (const taskId of ids) {
        cancelTaskExit(taskId);
      }

      const rollback = () => {
        setTasks((prev) => {
          const merged = new Map(prev.map((task) => [task.id, task] as const));
          for (const task of removed) merged.set(task.id, task);
          return Array.from(merged.values());
        });
      };

      queueMutation({
        key: `tasks:delete:${ids.slice().sort().join(",")}`,
        toastMessage: L.toastDeleted,
        icon: <Trash2 className="size-4" />,
        // A delete cannot be taken back on the server: it waits, and Undo cancels it.
        irreversible: true,
        execute: async (signal) => {
          for (const taskId of ids) {
            await operations.deleteTask(taskId, { signal });
          }
        },
        undo: rollback,
        undoToastMessage: L.toastDeleteUndone,
      });
    },
    [
      L.toastDeleteUndone,
      L.toastDeleted,
      cancelTaskExit,
      operations,
      queueMutation,
      setTasks,
      taskLists,
      tasks,
    ],
  );

  const requestDeleteTask = useCallback(
    (taskId: string) => {
      requestConfirm({
        title: L.deleteConfirmTitle,
        description: L.deleteConfirmBody,
        confirmLabel: L.delete,
        cancelLabel: L.cancel,
        onConfirm: () => deleteTasks([taskId]),
      });
    },
    [L.cancel, L.delete, L.deleteConfirmBody, L.deleteConfirmTitle, deleteTasks, requestConfirm],
  );

  const moveToList = useCallback(
    (ids: string[], listId: string) => {
      if (!operations) return;
      if (!canWriteTaskList(taskLists.find((list) => list.id === listId))) return;
      const listName = taskListName(listId, taskLists);
      const before = tasks.filter((task) => {
        if (!ids.includes(task.id)) return false;
        return canWriteTaskList(taskLists.find((list) => list.id === task.taskListId));
      });
      if (before.length === 0) return;

      for (const taskId of ids) {
        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? { ...task, taskListId: listId } : task)),
        );
      }

      const toastMessage = tasksMoveToastMessage(before.length, listName, L);
      const rollback = () => {
        setTasks((prev) => {
          const snapshot = new Map(before.map((task) => [task.id, task.taskListId] as const));
          return prev.map((task) =>
            snapshot.has(task.id) ? { ...task, taskListId: snapshot.get(task.id)! } : task,
          );
        });
      };

      queueMutation({
        key: `tasks:move:${listId}:${ids.slice().sort().join(",")}`,
        toastMessage,
        execute: (signal, mark) => moveTasksToList(operations, before, listId, signal, mark),
        revert: (completed) => moveTasksBack(operations, setTasks, before, completed),
        undo: rollback,
        undoToastMessage: L.toastMoveUndone,
      });
    },
    [L, operations, queueMutation, setTasks, taskLists, tasks],
  );

  const handleTaskExitAnimationEnd = useCallback(
    (taskId: string) => {
      exitAnimation.finishTaskExit(taskId, shouldHideCompletedTaskAfterExit(view));
    },
    [exitAnimation, view],
  );

  return {
    createTaskFromForm,
    toggleTaskComplete,
    editTask,
    editDialog,
    editingTask,
    closeEditTask,
    autosaveTask,
    requestDeleteTask,
    moveToList,
    confirmDialog,
    handleTaskExitAnimationEnd,
  };
}

export type TasksMutationsState = ReturnType<typeof useTasksMutations>;
