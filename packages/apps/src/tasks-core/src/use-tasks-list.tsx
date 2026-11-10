import { useCallback, useEffect, useRef, useState } from "react";
import { blurWorkspaceDetailEditor } from "@/hooks/blur-workspace-detail-editor";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import type { Task } from "@/lib/models/tasks-types";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";

export type UseTasksListArgs = {
  shell: TasksShellState;
  /** The rows the list shows, in order: what arrows and Shift-click walk over. */
  visibleIds: string[];
};

/**
 * The Tasks list on the shared workspace list controller (as Notes and Contacts):
 * the open task, multi-select (Cmd/Shift-click, long-press), arrow navigation,
 * drag to a sidebar list, and the write queue with undo.
 */
export function useTasksList({ shell, visibleIds }: UseTasksListArgs) {
  const { tasks, setTasks, view, workspaceLayoutRef, showMutationError } = shell;
  const [activeId, setActiveId] = useState("");

  const openMobileDetail = useCallback(
    (taskId?: string) => {
      const during = taskId === undefined ? undefined : () => setActiveId(taskId);
      const handle = workspaceLayoutRef.current;
      if (handle) {
        handle.openMobileDetail(during);
        return;
      }
      during?.();
    },
    [workspaceLayoutRef],
  );

  const controller = useWorkspaceListController<Task>({
    items: tasks,
    setItems: setTasks,
    visibleIds,
    activeId,
    setActiveId,
    onPrimarySelect: (id) => {
      blurWorkspaceDetailEditor();
      openMobileDetail(id);
    },
    onNavigateToId: () => {
      blurWorkspaceDetailEditor();
      openMobileDetail();
    },
    onMutationError: showMutationError,
  });
  const { selectSingle, setSelectedIds, setSelectionMode } = controller;

  /** Opens one task (a deep link): the same as a plain click on its row. */
  const openTask = useCallback(
    (taskId: string) => {
      selectSingle(taskId);
      openMobileDetail(taskId);
    },
    [openMobileDetail, selectSingle],
  );

  const closeTask = useCallback(() => {
    const during = () => {
      setActiveId("");
      setSelectedIds([]);
      setSelectionMode(false);
    };
    const handle = workspaceLayoutRef.current;
    if (handle) {
      handle.closeMobileDetail(during);
      return;
    }
    during();
  }, [setSelectedIds, setSelectionMode, workspaceLayoutRef]);

  // Another view ends a multi-selection; the open task stays selected (as in Notes).
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    const id = activeIdRef.current;
    setSelectionMode(false);
    if (id) selectSingle(id);
    else setSelectedIds([]);
  }, [selectSingle, setSelectedIds, setSelectionMode, view]);

  const activeTask = activeId ? (tasks.find((task) => task.id === activeId) ?? null) : null;

  // The open task was deleted (here or elsewhere): close the detail.
  useEffect(() => {
    if (activeId && !activeTask) closeTask();
  }, [activeId, activeTask, closeTask]);

  return { ...controller, activeId, activeTask, openTask, closeTask };
}

export type TasksListState = ReturnType<typeof useTasksList>;
