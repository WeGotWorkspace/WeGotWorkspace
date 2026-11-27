import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TasksAPIOperations, TasksUIData } from "@/lib/models/tasks-types";
import { buildDisplayTasks, filterTasksBySearch } from "@/tasks-core/src/tasks-task-utils";
import { useTasksExitAnimation } from "@/tasks-core/src/use-tasks-exit-animation";
import { useTasksIcsImport, type TasksImportedChange } from "@/tasks-core/src/use-tasks-ics-import";
import { useTasksList } from "@/tasks-core/src/use-tasks-list";
import { useTasksMutations } from "@/tasks-core/src/use-tasks-mutations";
import { useTasksProjectMutations } from "@/tasks-core/src/use-tasks-project-mutations";
import { useTasksShell } from "@/tasks-core/src/use-tasks-shell";
import { useCloseTaskOutsideProject } from "@/tasks-core/src/use-tasks-project-scope";
import type { TaskViewer, TaskWorkflowStatus } from "@/tasks-core/src/tasks-task-utils";

type UseTasksControllerArgs = {
  data: TasksUIData;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  initialTaskId?: string;
  onViewChange?: (view: string) => void;
  viewer?: TaskViewer;
};

export function useTasksController({
  data,
  labels,
  operations,
  bootstrapRevision = 0,
  initialView,
  initialTaskId,
  onViewChange,
  viewer,
}: UseTasksControllerArgs) {
  const shell = useTasksShell({
    data,
    labels,
    operations,
    bootstrapRevision,
    initialView,
    onViewChange,
    viewer,
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
  useCloseTaskOutsideProject(list.activeTask, shell.projectLists, list.closeTask);

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

  // Showing completed tasks again brings back the ones that just left the list.
  const { toggleStatusFilter: shellToggleStatusFilter } = shell;
  const toggleStatusFilter = useCallback(
    (status: TaskWorkflowStatus) => {
      if (status === "completed" && !shell.showCompletedTasks) clearHiddenTasks();
      shellToggleStatusFilter(status);
    },
    [clearHiddenTasks, shell.showCompletedTasks, shellToggleStatusFilter],
  );

  const selectView = useCallback(
    (nextView: string) => {
      shell.selectView(nextView);
    },
    [shell],
  );

  // The open task's live text, shown in the list row as it is typed (#2208).
  // Projection only: the room saves it, never the autosave.
  const showLiveText = useCallback(
    (taskId: string, text: { title: string; description: string }) =>
      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId &&
          (task.title !== text.title || (task.description ?? "") !== text.description)
            ? { ...task, title: text.title, description: text.description }
            : task,
        ),
      ),
    [setTasks],
  );

  return {
    L: shell.L,
    showLiveText,
    taskLists: shell.visibleLists,
    view: shell.view,
    viewLabel: shell.viewLabel,
    canCreateTask: shell.canCreateTask,
    visibleTasks: shell.visibleTasks,
    showCompletedTasks: shell.showCompletedTasks,
    statusFilter: shell.statusFilter,
    priorityFilter: shell.priorityFilter,
    statusFilterApplies: shell.statusFilterApplies,
    assigneePeople: shell.assigneePeople,
    toggleStatusFilter,
    togglePriorityFilter: shell.togglePriorityFilter,
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
    // "New list" is hidden while a Project is selected (#818).
    canManageProjects: projectMutations.canManageProjects && shell.projectLists === null,
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
