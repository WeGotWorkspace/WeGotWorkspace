import { useCallback } from "react";
import { Plus } from "lucide-react";
import type { Task } from "@/tasks-core/src/tasks-types";
import type { TasksTaskFormValue } from "@/tasks-core/src/tasks-task-form";
import { TASK_PRIORITY_NONE } from "@/tasks-core/src/tasks-priority";
import { canWriteTaskList, mergeCreatedTask } from "@/tasks-core/src/tasks-task-utils";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";

type UseCreateTaskFromFormArgs = Pick<
  TasksShellState,
  | "L"
  | "taskLists"
  | "setTasks"
  | "operations"
  | "ensureTaskListVisible"
  | "show"
  | "showMutationError"
>;

/** Adds a task from the new-task form: shown at once, swapped for the saved task when the server answers. */
export function useCreateTaskFromForm({
  L,
  taskLists,
  setTasks,
  operations,
  ensureTaskListVisible,
  show,
  showMutationError,
}: UseCreateTaskFromFormArgs) {
  return useCallback(
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
        show(L.toastTaskAdded, { icon: <Plus className="size-4" /> });
      } catch {
        setTasks((prev) => prev.filter((task) => task.id !== tempId));
        showMutationError();
      }
    },
    [
      L.toastTaskAdded,
      ensureTaskListVisible,
      operations,
      setTasks,
      show,
      showMutationError,
      taskLists,
    ],
  );
}
