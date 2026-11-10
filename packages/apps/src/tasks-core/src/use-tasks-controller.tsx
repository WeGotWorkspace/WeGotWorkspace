import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TasksAPIOperations, TasksUIData } from "@/tasks-core/src/tasks-types";
import { buildDisplayTasks, filterTasksBySearch } from "@/tasks-core/src/tasks-task-utils";
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
  const exitAnimation = useTasksExitAnimation();
  const { clearHiddenTasks } = exitAnimation;
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

  // The list search: a task matches on its title, notes or tags.
  const [searchQuery, setSearchQuery] = useState("");
  const listTasks = useMemo(
    () => filterTasksBySearch(displayTasks, searchQuery),
    [displayTasks, searchQuery],
  );
  const visibleIds = useMemo(() => listTasks.map((task) => task.id), [listTasks]);

  const list = useTasksList({ shell, visibleIds });
  const mutations = useTasksMutations({ shell, list, exitAnimation });
  const projectMutations = useTasksProjectMutations({ shell });
  const openedTaskDeepLinkRef = useRef<string | null>(null);
  const { openTask } = list;

  useEffect(() => {
    if (!initialTaskId) return;
    if (openedTaskDeepLinkRef.current === initialTaskId) return;
    if (!data.tasks.some((task) => task.id === initialTaskId)) return;
    openedTaskDeepLinkRef.current = initialTaskId;
    openTask(initialTaskId);
  }, [data.tasks, initialTaskId, openTask]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: list.selectedIds.length,
    selectionMode: list.selectionMode,
    onRequestDeleteSelection: mutations.requestDeleteSelected,
    onNavigateList: list.navigateListByKeyboard,
    onUndoQueuedAction: list.undoLatest,
  });

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
    workspaceLayoutRef: shell.workspaceLayoutRef,
    searchInputRef,
    createListId: shell.createListId,
    hiddenTaskListIds: shell.hiddenTaskListIds,
    toggleTaskListVisibility: shell.toggleTaskListVisibility,
    exitingTaskIds: exitAnimation.exitingTaskIds,
    isItemDragging: list.isItemDragging,
    itemDragHandlers: list.itemDragHandlers,
    sidebarDropZoneProps: list.sidebarDropZoneProps,
    confirmDialog: mutations.confirmDialog,
    requestMoveTask: mutations.requestMoveTask,
    activeId: list.activeId,
    activeTask: list.activeTask,
    closeTask: list.closeTask,
    selectedIds: list.selectedIds,
    selectionMode: list.selectionMode,
    handleSelect: list.handleSelect,
    enterSelectionFor: list.enterSelectionFor,
    selectionBar: mutations.selectionBar,
    selectionBarButtons: mutations.selectionBarButtons,
    moveDialog: mutations.moveDialog,
    setMoveDialog: mutations.setMoveDialog,
    searchQuery,
    setSearchQuery,
    listTasks,
    autosaveTask: mutations.autosaveTask,
    selectView,
    createTaskFromForm: mutations.createTaskFromForm,
    toggleTaskComplete: mutations.toggleTaskComplete,
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
