import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Trash2 } from "lucide-react";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { WorkspaceActionButton } from "@/hooks/workspace-list-controller-types";
import type { ConfirmDialogRequest } from "@/hooks/use-confirm-dialog";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { canWriteTaskList, isTaskCompleted } from "@/tasks-core/src/tasks-task-utils";
import type { TasksListState } from "@/tasks-core/src/use-tasks-list";

type UseTasksSelectionActionsArgs = {
  L: TasksUILabels;
  list: TasksListState;
  tasks: Task[];
  taskLists: TaskList[];
  requestConfirm: (request: ConfirmDialogRequest) => void;
  deleteTasks: (ids: string[]) => void;
  setTasksCompleted: (ids: readonly string[], completing: boolean) => void;
};

/** Multi-select: the shared selection bar and the detail pane's actions for the selected tasks. */
export function useTasksSelectionActions({
  L,
  list,
  tasks,
  taskLists,
  requestConfirm,
  deleteTasks,
  setTasksCompleted,
}: UseTasksSelectionActionsArgs) {
  const { selectedIds, selectionMode, exitSelection, activeId } = list;
  const [moveDialog, setMoveDialog] = useState<{ ids: string[] } | null>(null);

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedIds.includes(task.id)),
    [selectedIds, tasks],
  );
  const selectionWritable = selectedTasks.filter((task) =>
    canWriteTaskList(taskLists.find((list) => list.id === task.taskListId)),
  );
  const allSelectedCompleted =
    selectionWritable.length > 0 && selectionWritable.every((task) => isTaskCompleted(task));

  const requestDeleteSelected = useCallback(() => {
    const ids = selectionWritable.map((task) => task.id);
    if (ids.length === 0) return;
    requestConfirm({
      title: L.deleteSelectedTitle(ids.length),
      description: L.deleteSelectedBody(ids.length),
      confirmLabel: L.delete,
      cancelLabel: L.cancel,
      onConfirm: () => {
        deleteTasks(ids);
        exitSelection();
      },
    });
  }, [L, deleteTasks, exitSelection, requestConfirm, selectionWritable]);

  const selectionActionButtons = useMemo<WorkspaceActionButton[]>(
    () =>
      selectionWritable.length === 0
        ? []
        : [
            {
              label: allSelectedCompleted ? L.markIncomplete : L.selectionComplete,
              icon: <CheckCircle2 className="size-4" />,
              onClick: () =>
                setTasksCompleted(
                  selectionWritable.map((task) => task.id),
                  !allSelectedCompleted,
                ),
              active: allSelectedCompleted,
            },
            {
              label: L.selectionMoveToList,
              icon: <ListTodo className="size-4" />,
              onClick: () => setMoveDialog({ ids: selectionWritable.map((task) => task.id) }),
            },
            {
              label: L.delete,
              icon: <Trash2 className="size-4" />,
              onClick: requestDeleteSelected,
              severity: "danger" as const,
            },
          ],
    [L, allSelectedCompleted, requestDeleteSelected, selectionWritable, setTasksCompleted],
  );
  const { selectionBarButtons, selectionBar } = useWorkspaceSelectionPresentation({
    selectedIds,
    selectionMode,
    activeId,
    exitSelection,
    actionButtons: selectionActionButtons,
    doneLabel: L.selectionDone,
  });

  return { moveDialog, setMoveDialog, requestDeleteSelected, selectionBar, selectionBarButtons };
}
