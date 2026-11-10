import { useCallback } from "react";
import { CheckCircle2, Circle, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import {
  canWriteTaskList,
  isTaskCompleted,
  shouldHideCompletedTaskAfterExit,
  taskListName,
} from "@/tasks-core/src/tasks-task-utils";
import {
  tasksCompleteToastMessage,
  tasksMoveToastMessage,
} from "@/tasks-core/src/tasks-toast-messages";
import { moveTasksBack, moveTasksToList, statusWrites } from "@/tasks-core/src/tasks-undo-writes";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";
import type { TasksExitAnimationState } from "@/tasks-core/src/use-tasks-exit-animation";
import type { TasksListState } from "@/tasks-core/src/use-tasks-list";
import { useCreateTaskFromForm } from "@/tasks-core/src/use-create-task-from-form";
import { useTaskDetailAutosave } from "@/tasks-core/src/use-task-detail-autosave";
import { useTasksSelectionActions } from "@/tasks-core/src/use-tasks-selection-actions";

type UseTasksMutationsArgs = {
  shell: TasksShellState;
  list: TasksListState;
  exitAnimation: TasksExitAnimationState;
};

export function useTasksMutations({ shell, list, exitAnimation }: UseTasksMutationsArgs) {
  const {
    L,
    tasks,
    setTasks,
    taskLists,
    operations,
    showMutationError,
    show,
    view,
    ensureTaskListVisible,
  } = shell;
  const { queueMutation } = list;
  const { beginTaskExit, cancelTaskExit } = exitAnimation;

  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "tasks-dialog-surface",
  });

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

  const createTaskFromForm = useCreateTaskFromForm({
    L,
    taskLists,
    setTasks,
    operations,
    ensureTaskListVisible,
    show,
    showMutationError,
  });

  const { autosaveTask, setStatusInOrder } = useTaskDetailAutosave({
    tasks,
    taskLists,
    setTasks,
    operations,
    patchTask,
    showMutationError,
  });

  /**
   * Completes (or reopens) tasks as one undoable write: one task from its circle,
   * or a selection. Read-only lists are skipped.
   */
  const setTasksCompleted = useCallback(
    (ids: readonly string[], completing: boolean) => {
      if (!operations) return;
      const changed = tasks.filter(
        (task) =>
          ids.includes(task.id) &&
          isTaskCompleted(task) !== completing &&
          canWriteTaskList(taskLists.find((list) => list.id === task.taskListId)),
      );
      if (changed.length === 0) return;
      const nextStatus = completing ? "completed" : "needs-action";
      const before = new Map(
        changed.map((task) => [task.id, task.workflowStatus ?? "needs-action"] as const),
      );

      for (const task of changed) {
        if (completing) beginTaskExit(task.id);
        else cancelTaskExit(task.id);
      }
      setTasks((prev) =>
        prev.map((item) => (before.has(item.id) ? { ...item, workflowStatus: nextStatus } : item)),
      );

      const rollback = () => {
        for (const taskId of before.keys()) cancelTaskExit(taskId);
        setTasks((prev) =>
          prev.map((item) =>
            before.has(item.id) ? { ...item, workflowStatus: before.get(item.id)! } : item,
          ),
        );
      };

      queueMutation({
        key: `tasks:complete:${[...before.keys()].sort().join(",")}`,
        toastMessage: tasksCompleteToastMessage(completing, changed.length, L),
        icon: completing ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />,
        // On each task's save chain: after typed text that is still saving.
        ...statusWrites(setStatusInOrder, before, nextStatus),
        undo: rollback,
        undoToastMessage: L.toastCompleteUndone,
      });
    },
    [
      L,
      beginTaskExit,
      cancelTaskExit,
      operations,
      setStatusInOrder,
      queueMutation,
      setTasks,
      taskLists,
      tasks,
    ],
  );

  const toggleTaskComplete = useCallback(
    (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (task) setTasksCompleted([taskId], !isTaskCompleted(task));
    },
    [setTasksCompleted, tasks],
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
        toastMessage: L.toastTasksDeleted(removed.length),
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
    [L, cancelTaskExit, operations, queueMutation, setTasks, taskLists, tasks],
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

  /** The open task's list switcher: confirm before the move, as Notes and Contacts do. */
  const requestMoveTask = useCallback(
    (listName: string, move: () => void) => {
      requestConfirm({
        title: L.moveTaskTitle,
        description: L.moveTaskDescription(listName),
        confirmLabel: L.moveConfirm,
        cancelLabel: L.cancel,
        onConfirm: move,
      });
    },
    [L, requestConfirm],
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

  const { moveDialog, setMoveDialog, requestDeleteSelected, selectionBar, selectionBarButtons } =
    useTasksSelectionActions({
      L,
      list,
      tasks,
      taskLists,
      requestConfirm,
      deleteTasks,
      setTasksCompleted,
    });

  const handleTaskExitAnimationEnd = useCallback(
    (taskId: string) => {
      exitAnimation.finishTaskExit(taskId, shouldHideCompletedTaskAfterExit(view));
    },
    [exitAnimation, view],
  );

  return {
    createTaskFromForm,
    toggleTaskComplete,
    setTasksCompleted,
    requestDeleteSelected,
    moveDialog,
    setMoveDialog,
    selectionBar,
    selectionBarButtons,
    autosaveTask,
    requestDeleteTask,
    requestMoveTask,
    moveToList,
    confirmDialog,
    handleTaskExitAnimationEnd,
  };
}

export type TasksMutationsState = ReturnType<typeof useTasksMutations>;
