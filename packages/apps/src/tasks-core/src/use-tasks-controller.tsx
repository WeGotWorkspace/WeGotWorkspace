import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TasksAPIOperations, TasksUIData } from "@/tasks-core/src/tasks-types";
import { buildDisplayTasks } from "@/tasks-core/src/tasks-task-utils";
import { useTasksExitAnimation } from "@/tasks-core/src/use-tasks-exit-animation";
import { useTasksIcsImport, type TasksImportedChange } from "@/tasks-core/src/use-tasks-ics-import";
import { useTasksList } from "@/tasks-core/src/use-tasks-list";
import { useTasksMutations } from "@/tasks-core/src/use-tasks-mutations";
import { useTasksProjectMutations } from "@/tasks-core/src/use-tasks-project-mutations";
import { useTasksShell } from "@/tasks-core/src/use-tasks-shell";

type UseTasksControllerArgs = {
  data: TasksUIData;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  initialTaskId?: string;
  onViewChange?: (view: string) => void;
};

export function useTasksController({
  data,
  labels,
  operations,
  bootstrapRevision = 0,
  initialView,
  initialTaskId,
  onViewChange,
}: UseTasksControllerArgs) {
  const shell = useTasksShell({
    data,
    labels,
    operations,
    bootstrapRevision,
    initialView,
    onViewChange,
  });
  const list = useTasksList({ shell });
  const exitAnimation = useTasksExitAnimation();
  const mutations = useTasksMutations({ shell, list, exitAnimation });
  const projectMutations = useTasksProjectMutations({ shell });
  const { clearHiddenTasks } = exitAnimation;
  const openedTaskDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialTaskId) return;
    if (openedTaskDeepLinkRef.current === initialTaskId) return;
    if (!data.tasks.some((task) => task.id === initialTaskId)) return;
    openedTaskDeepLinkRef.current = initialTaskId;
    mutations.editTask(initialTaskId);
  }, [data.tasks, initialTaskId, mutations]);

  const { setTaskLists, setTasks, ensureTaskListVisible, selectView: selectShellView } = shell;
  const handleTasksImported = useCallback(
    ({ taskListId, createdList, tasks }: TasksImportedChange) => {
      if (createdList) {
        setTaskLists((prev) =>
          prev.some((list) => list.id === createdList.id) ? prev : [...prev, createdList],
        );
      }
      if (tasks.length > 0) {
        const importedIds = new Set(tasks.map((task) => task.id));
        setTasks((prev) => [...prev.filter((task) => !importedIds.has(task.id)), ...tasks]);
      }
      ensureTaskListVisible(taskListId);
      selectShellView(`list:${taskListId}`);
    },
    [ensureTaskListVisible, selectShellView, setTaskLists, setTasks],
  );
  const icsImport = useTasksIcsImport({
    operations: shell.operations,
    labels: shell.L,
    onImported: handleTasksImported,
  });

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: 0,
    onRequestDeleteSelection: () => {},
    onUndoQueuedAction: list.undoLatest,
    listNavigationEnabled: false,
  });

  useEffect(() => {
    clearHiddenTasks();
  }, [clearHiddenTasks, shell.view]);

  const displayTasks = useMemo(
    () =>
      buildDisplayTasks(
        shell.tasks,
        shell.visibleTasks,
        exitAnimation.exitingTaskIds,
        shell.showCompletedTasks ? new Set() : exitAnimation.hiddenTaskIds,
      ),
    [
      exitAnimation.exitingTaskIds,
      exitAnimation.hiddenTaskIds,
      shell.showCompletedTasks,
      shell.tasks,
      shell.visibleTasks,
    ],
  );

  const toggleShowCompletedTasks = useCallback(() => {
    if (!shell.showCompletedTasks) {
      clearHiddenTasks();
    }
    shell.toggleShowCompletedTasks();
  }, [clearHiddenTasks, shell]);

  const selectView = useCallback(
    (nextView: string) => {
      shell.selectView(nextView);
    },
    [shell],
  );

  return {
    L: shell.L,
    taskLists: shell.taskLists,
    view: shell.view,
    viewLabel: shell.viewLabel,
    canCreateTask: shell.canCreateTask,
    visibleTasks: shell.visibleTasks,
    showCompletedTasks: shell.showCompletedTasks,
    showCompletedToggle: shell.showCompletedToggle,
    toggleShowCompletedTasks,
    displayTasks,
    sidebarOpen: shell.sidebarOpen,
    setSidebarOpen: shell.setSidebarOpen,
    createListId: shell.createListId,
    hiddenTaskListIds: shell.hiddenTaskListIds,
    toggleTaskListVisibility: shell.toggleTaskListVisibility,
    exitingTaskIds: exitAnimation.exitingTaskIds,
    isItemDragging: list.isItemDragging,
    itemDragHandlers: list.itemDragHandlers,
    sidebarDropZoneProps: list.sidebarDropZoneProps,
    confirmDialog: mutations.confirmDialog,
    editDialog: mutations.editDialog,
    editingTask: mutations.editingTask,
    closeEditTask: mutations.closeEditTask,
    saveEditedTask: mutations.saveEditedTask,
    selectView,
    createTaskFromForm: mutations.createTaskFromForm,
    toggleTaskComplete: mutations.toggleTaskComplete,
    editTask: mutations.editTask,
    requestDeleteTask: mutations.requestDeleteTask,
    moveToList: mutations.moveToList,
    handleTaskExitAnimationEnd: mutations.handleTaskExitAnimationEnd,
    canManageProjects: projectMutations.canManageProjects,
    projectDialog: projectMutations.projectDialog,
    setProjectDialog: projectMutations.setProjectDialog,
    openCreateProjectDialog: projectMutations.openCreateProjectDialog,
    openEditProjectDialog: projectMutations.openEditProjectDialog,
    createProject: projectMutations.createProject,
    updateProject: projectMutations.updateProject,
    patchShareWith: projectMutations.patchShareWith,
    removeSharedList: projectMutations.removeSharedList,
    deleteList: projectMutations.deleteList,
    icsImport,
  };
}

export type TasksControllerState = ReturnType<typeof useTasksController>;
