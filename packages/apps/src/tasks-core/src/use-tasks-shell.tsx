import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { mergeTasksLabels, type TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { DEFAULT_TASKS_VIEW, normalizeTasksView } from "@/tasks-core/src/tasks-route-search";
import {
  canWriteTaskList,
  defaultTaskListId,
  filterHiddenCompletedTasks,
  filterTasksByHiddenLists,
  filterTasksByView,
  shouldApplyCompletedTaskFilter,
} from "@/tasks-core/src/tasks-task-utils";
import type { Task, TasksAPIOperations, TasksUIData } from "@/tasks-core/src/tasks-types";
import { useTasksHiddenIds } from "@/tasks-core/src/use-tasks-hidden-ids";

export type UseTasksShellArgs = {
  data: TasksUIData;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  onViewChange?: (view: string) => void;
};

export function useTasksShell({
  data,
  labels,
  operations,
  bootstrapRevision = 0,
  initialView,
  onViewChange,
}: UseTasksShellArgs) {
  const L = useMemo(() => mergeTasksLabels(labels), [labels]);
  const [tasks, setTasks] = useState<Task[]>(() => data.tasks);
  const [taskLists, setTaskLists] = useState(() => data.taskLists);
  const [view, setView] = useState<string>(() => initialView ?? DEFAULT_TASKS_VIEW);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarOverlayViewport());
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const { hiddenTaskListIds, setHiddenTaskListIds } = useTasksHiddenIds(taskLists);

  const { show, showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not sync this change. Please try again.") => showError(fallback),
    [showError],
  );

  useEffect(() => {
    setTasks(data.tasks);
    setTaskLists(data.taskLists);
  }, [bootstrapRevision, data]);

  const pendingViewRef = useRef<string | null>(null);
  const lastInitialViewRef = useRef(initialView);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    if (initialView === undefined) return;
    const normalized = normalizeTasksView(initialView, taskLists);
    const pending = pendingViewRef.current;
    const initialViewChanged = lastInitialViewRef.current !== initialView;
    lastInitialViewRef.current = initialView;

    if (pending !== null) {
      if (normalized === pending) {
        pendingViewRef.current = null;
      } else if (initialViewChanged) {
        onViewChangeRef.current?.(pending);
      }
      return;
    }
    setView((current) => (current === normalized ? current : normalized));
  }, [initialView, taskLists]);

  const viewLabel = useMemo(() => {
    if (view === "state:all") return L.stateAll;
    if (view === "state:today") return L.stateToday;
    if (view === "state:upcoming") return L.stateUpcoming;
    if (view === "state:overdue") return L.stateOverdue;
    if (view === "state:needs-action") return L.stateNeedsAction;
    if (view === "state:in-process") return L.stateInProcess;
    if (view === "state:completed") return L.stateCompleted;
    if (view === "state:cancelled") return L.stateCancelled;
    if (view.startsWith("priority:")) {
      const slug = view.slice(9);
      if (slug === "high") return L.priorityHigh;
      if (slug === "medium") return L.priorityMedium;
      if (slug === "low") return L.priorityLow;
      if (slug === "none") return L.priorityNone;
    }
    if (view.startsWith("list:")) {
      const listId = view.slice(5);
      return taskLists.find((list) => list.id === listId)?.name ?? listId;
    }
    return L.fallbackViewTitle;
  }, [L, taskLists, view]);

  const selectedListId = view.startsWith("list:") ? view.slice(5) : null;
  const createListId = useMemo(
    () => selectedListId ?? defaultTaskListId(taskLists),
    [selectedListId, taskLists],
  );
  const createTargetList = useMemo(
    () => taskLists.find((list) => list.id === createListId),
    [createListId, taskLists],
  );
  const canCreateTask = Boolean(operations) && canWriteTaskList(createTargetList);

  const ensureTaskListVisible = useCallback(
    (listId: string) => {
      setHiddenTaskListIds((current) => {
        if (!current.has(listId)) return current;
        const next = new Set(current);
        next.delete(listId);
        return next;
      });
    },
    [setHiddenTaskListIds],
  );

  const toggleTaskListVisibility = useCallback(
    (listId: string) => {
      setHiddenTaskListIds((current) => {
        const next = new Set(current);
        if (next.has(listId)) next.delete(listId);
        else next.add(listId);
        return next;
      });
    },
    [setHiddenTaskListIds],
  );

  const selectView = useCallback(
    (nextView: string) => {
      const normalized = normalizeTasksView(nextView, taskLists);
      pendingViewRef.current = normalized;
      setView(normalized);
      if (isSidebarOverlayViewport()) {
        setSidebarOpen(false);
      }
    },
    [taskLists],
  );

  const viewSyncedRef = useRef(false);
  useEffect(() => {
    if (!viewSyncedRef.current) {
      viewSyncedRef.current = true;
      return;
    }
    onViewChangeRef.current?.(view);
  }, [view]);

  const showCompletedToggle = useMemo(() => shouldApplyCompletedTaskFilter(view), [view]);

  const visibleTasks = useMemo(() => {
    const byView = filterTasksByHiddenLists(
      filterTasksByView(tasks, view),
      view,
      hiddenTaskListIds,
    );
    if (!showCompletedToggle || showCompletedTasks) return byView;
    return filterHiddenCompletedTasks(byView);
  }, [hiddenTaskListIds, showCompletedTasks, showCompletedToggle, tasks, view]);

  const toggleShowCompletedTasks = useCallback(() => {
    setShowCompletedTasks((current) => !current);
  }, []);

  return {
    L,
    tasks,
    setTasks,
    taskLists,
    setTaskLists,
    view,
    viewLabel,
    sidebarOpen,
    setSidebarOpen,
    visibleTasks,
    showCompletedTasks,
    showCompletedToggle,
    toggleShowCompletedTasks,
    canCreateTask,
    selectView,
    operations,
    createListId,
    hiddenTaskListIds,
    toggleTaskListVisibility,
    ensureTaskListVisible,
    show,
    showMutationError,
  };
}

export type TasksShellState = ReturnType<typeof useTasksShell>;
