import { useCallback, useMemo, useState } from "react";
import { Check, CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import type { TaskEditDialogState } from "@/tasks-core/src/tasks-edit-dialog";
import type { TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from "@/tasks-core/src/tasks-priority";
import {
  canWriteTaskList,
  isTaskCompleted,
  mergeCreatedTask,
  shouldHideCompletedTaskAfterExit,
  taskAlertsEqual,
  taskDueIsDateOnly,
  taskListName,
} from "@/tasks-core/src/tasks-task-utils";
import {
  tasksCompleteToastMessage,
  tasksMoveToastMessage,
} from "@/tasks-core/src/tasks-toast-messages";
import type { TasksCreateInput } from "@/tasks-core/src/tasks-task-form";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";
import type { TasksExitAnimationState } from "@/tasks-core/src/use-tasks-exit-animation";
import type { TasksListState } from "@/tasks-core/src/use-tasks-list";

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
  if (next.due && next.showWithoutTime !== taskDueIsDateOnly(task.due, task.showWithoutTime)) {
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
  const [editDialog, setEditDialog] = useState<TaskEditDialogState>(null);

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
    }: TasksCreateInput) => {
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
        undo: rollback,
        onError: rollback,
        undoToastMessage: L.toastCompleteUndone,
        executeImmediately: true,
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

  const saveEditedTask = useCallback(
    async (input: TasksTaskFormValue) => {
      if (!editDialog || !operations) return;
      const taskId = editDialog.taskId;
      const task = tasks.find((item) => item.id === taskId);
      if (!task || !input.title.trim()) return;
      if (!canWriteTaskList(taskLists.find((list) => list.id === task.taskListId))) return;

      const next = taskEditValues(input);
      const listChanged = input.listId !== task.taskListId;
      const patch = taskEditPatch(task, next);

      const hasPatch = Object.keys(patch).length > 0;
      if (!hasPatch && !listChanged) {
        setEditDialog(null);
        return;
      }

      const snapshot = task;
      const optimistic: Task = { ...task, ...next, taskListId: input.listId };

      setTasks((prev) => prev.map((item) => (item.id === taskId ? optimistic : item)));
      setEditDialog(null);
      shell.show(L.toastTaskUpdated, { icon: <Check className="size-4" /> });

      // A move that landed stays when the patch after it fails.
      let rollback: Task = snapshot;
      try {
        // The patch starts from the version the move produced, not the one
        // this dialog opened on, or the server refuses it as a conflict (#1814).
        const moved = listChanged
          ? await operations.moveTaskToList(taskId, input.listId)
          : undefined;
        if (moved) rollback = moved;
        if (hasPatch) {
          await patchTask(taskId, patch, {
            ifMatch: (moved as (Task & { etag?: string }) | undefined)?.etag,
          });
        }
      } catch {
        setTasks((prev) => prev.map((item) => (item.id === taskId ? rollback : item)));
        showMutationError();
      }
    },
    [
      editDialog,
      L.toastTaskUpdated,
      operations,
      patchTask,
      setTasks,
      shell,
      showMutationError,
      taskLists,
      tasks,
    ],
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
        execute: async (signal) => {
          for (const taskId of ids) {
            await operations.deleteTask(taskId, { signal });
          }
        },
        undo: rollback,
        onError: rollback,
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
        execute: async (signal) => {
          for (const taskId of ids) {
            await operations.moveTaskToList(taskId, listId, { signal });
          }
        },
        undo: rollback,
        onError: rollback,
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
    saveEditedTask,
    requestDeleteTask,
    moveToList,
    confirmDialog,
    handleTaskExitAnimationEnd,
  };
}

export type TasksMutationsState = ReturnType<typeof useTasksMutations>;
