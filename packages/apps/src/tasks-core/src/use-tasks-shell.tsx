import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import { useDefaultCollectionId } from "@/lib/default-collection-prefs";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";
import { mergeTasksLabels, type TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { DEFAULT_TASKS_VIEW, normalizeTasksView } from "@/tasks-core/src/tasks-route-search";
import { useLeaveRemovedListView } from "@/tasks-core/src/use-leave-removed-list-view";
import {
  defaultTaskListId,
  DEFAULT_TASK_PRIORITY_FILTER,
  DEFAULT_TASK_STATUS_FILTER,
  filterTasksByPriorityFilter,
  filterTasksByStatus,
  type TaskWorkflowStatus,
  filterTasksByHiddenLists,
  filterTasksByView,
  shouldApplyCompletedTaskFilter,
  ASSIGNED_TO_ME_VIEW,
  ASSIGNEE_VIEW_PREFIX,
  isAssigneeView,
  type TaskViewer,
} from "@/tasks-core/src/tasks-task-utils";
import type { PriorityFilterSlug } from "@/tasks-core/src/tasks-priority";
import { assigneePeopleOfTasks } from "@/tasks-core/src/tasks-assignees";
import { canWriteTaskList } from "@/lib/models/task-lists";
import type { Task, TasksAPIOperations, TasksUIData } from "@/lib/models/tasks-types";
import { useTasksHiddenIds } from "@/tasks-core/src/use-tasks-hidden-ids";
import {
  projectCreateListId,
  tasksInProjectLists,
  useLeaveListOutsideProject,
  useTasksProjectScope,
} from "@/tasks-core/src/use-tasks-project-scope";

export type UseTasksShellArgs = {
  data: TasksUIData;
  labels?: Partial<TasksUILabels>;
  operations?: TasksAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  onViewChange?: (view: string) => void;
  /** The signed-in person, for "Assigned to me" (#2172). */
  viewer?: TaskViewer;
};

type AssigneePerson = { username: string; name: string };

function tasksViewLabel(
  view: string,
  L: TasksUILabels,
  taskLists: TasksUIData["taskLists"],
  assigneePeople: readonly AssigneePerson[],
): string {
  if (view === "state:all") return L.stateAll;
  if (view === "state:today") return L.stateToday;
  if (view === "state:upcoming") return L.stateUpcoming;
  if (view === "state:overdue") return L.stateOverdue;
  if (view === ASSIGNED_TO_ME_VIEW) return L.stateAssignedToMe;
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
  if (isAssigneeView(view)) {
    const username = view.slice(ASSIGNEE_VIEW_PREFIX.length);
    return assigneePeople.find((person) => person.username === username)?.name ?? username;
  }
  return L.fallbackViewTitle;
}

function toggleIn<T>(current: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useTasksShell({
  data,
  labels,
  operations,
  bootstrapRevision = 0,
  initialView,
  onViewChange,
  viewer,
}: UseTasksShellArgs) {
  const L = useMemo(() => mergeTasksLabels(labels), [labels]);
  const [tasks, setTasks] = useState<Task[]>(() => data.tasks);
  const [taskLists, setTaskLists] = useState(() => data.taskLists);
  const [view, setView] = useState<string>(() => initialView ?? DEFAULT_TASKS_VIEW);
  // The two-pane layout owns the sidebar and the phone detail; views close them.
  const workspaceLayoutRef = useRef<WorkspaceAppHandle>(null);
  // The header filter: which statuses and priorities the list shows (this session only).
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<TaskWorkflowStatus>>(
    DEFAULT_TASK_STATUS_FILTER,
  );
  const [priorityFilter, setPriorityFilter] = useState<ReadonlySet<PriorityFilterSlug>>(
    DEFAULT_TASK_PRIORITY_FILTER,
  );
  const { hiddenTaskListIds, setHiddenTaskListIds } = useTasksHiddenIds(taskLists);
  const { projectLists, visibleLists } = useTasksProjectScope(taskLists);

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

  // The people in the sidebar's "Assigned to": colleagues with a task in the lists shown
  // (Project filter applied). The person being viewed stays, even with nothing left.
  const assigneePeople = useMemo(() => {
    const people = assigneePeopleOfTasks(
      tasksInProjectLists(tasks, projectLists),
      viewer?.username,
    );
    if (!isAssigneeView(view)) return people;
    const username = view.slice(ASSIGNEE_VIEW_PREFIX.length);
    if (people.some((person) => person.username === username)) return people;
    return [...people, { username, name: username }].sort((a, b) => a.name.localeCompare(b.name));
  }, [projectLists, tasks, view, viewer?.username]);

  const viewLabel = useMemo(
    () => tasksViewLabel(view, L, taskLists, assigneePeople),
    [L, assigneePeople, taskLists, view],
  );

  const selectedListId = view.startsWith("list:") ? view.slice(5) : null;
  const preferredListId = useDefaultCollectionId("tasks");
  // A selected Project's list is the default for new tasks (#818).
  const createListId = useMemo(
    () =>
      selectedListId ??
      projectCreateListId(projectLists) ??
      defaultTaskListId(taskLists, preferredListId),
    [selectedListId, projectLists, taskLists, preferredListId],
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
      workspaceLayoutRef.current?.closeMobileDetail();
      dismissSidebarOverlay(() => workspaceLayoutRef.current?.closeSidebar());
    },
    [taskLists],
  );
  useLeaveRemovedListView(view, taskLists, selectView);
  const followView = useCallback((nextView: string) => {
    pendingViewRef.current = nextView;
    setView(nextView);
  }, []);
  useLeaveListOutsideProject(view, taskLists, projectLists, followView);

  const viewSyncedRef = useRef(false);
  useEffect(() => {
    if (!viewSyncedRef.current) {
      viewSyncedRef.current = true;
      return;
    }
    onViewChangeRef.current?.(view);
  }, [view]);

  // The status segment does not apply on the status views themselves.
  const statusFilterApplies = useMemo(() => shouldApplyCompletedTaskFilter(view), [view]);
  /** A completed task leaves the list when it is completed, so the list tells it apart. */
  const showCompletedTasks = !statusFilterApplies || statusFilter.has("completed");

  const visibleTasks = useMemo(() => {
    const byView = filterTasksByHiddenLists(
      filterTasksByView(tasksInProjectLists(tasks, projectLists), view, viewer),
      view,
      hiddenTaskListIds,
    );
    const byStatus = statusFilterApplies ? filterTasksByStatus(byView, statusFilter) : byView;
    return filterTasksByPriorityFilter(byStatus, priorityFilter);
  }, [
    hiddenTaskListIds,
    priorityFilter,
    projectLists,
    statusFilter,
    statusFilterApplies,
    tasks,
    view,
    viewer,
  ]);

  const toggleStatusFilter = useCallback(
    (status: TaskWorkflowStatus) => setStatusFilter((current) => toggleIn(current, status)),
    [],
  );
  const togglePriorityFilter = useCallback(
    (slug: PriorityFilterSlug) => setPriorityFilter((current) => toggleIn(current, slug)),
    [],
  );

  return {
    L,
    tasks,
    setTasks,
    taskLists,
    setTaskLists,
    /** Null for "All Projects"; else the selected Project's lists (#818). */
    projectLists,
    /** The lists the sidebar and pickers show under the Project filter. */
    visibleLists,
    view,
    viewLabel,
    workspaceLayoutRef,
    visibleTasks,
    showCompletedTasks,
    statusFilter,
    priorityFilter,
    statusFilterApplies,
    assigneePeople,
    toggleStatusFilter,
    togglePriorityFilter,
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
