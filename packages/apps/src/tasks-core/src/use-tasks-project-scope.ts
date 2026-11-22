import { useEffect, useMemo } from "react";
import { canWriteTaskList } from "@/lib/models/task-lists";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import { collectionsInProject } from "@/lib/projects/project-match";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";
import { DEFAULT_TASKS_VIEW } from "@/tasks-core/src/tasks-route-search";

type ListRef = Pick<TaskList, "id">;

/** Tasks in the given lists; every task when no Project is selected (null). */
export function tasksInProjectLists(
  tasks: Task[],
  projectLists: readonly ListRef[] | null,
): Task[] {
  if (projectLists === null) return tasks;
  const ids = new Set(projectLists.map((list) => list.id));
  return tasks.filter((task) => ids.has(task.taskListId));
}

/** Where a new task goes while a Project is selected: its first writable list. */
export function projectCreateListId(
  projectLists: readonly Pick<TaskList, "id" | "myRights">[] | null,
): string | null {
  if (projectLists === null) return null;
  return projectLists.find((list) => canWriteTaskList(list))?.id ?? null;
}

/**
 * The view to go to when the open list is outside the selected Project: the Project's
 * list, else the default view. Null keeps the view (no Project, a smart view such as
 * Today, or a list not loaded yet).
 */
export function tasksViewOutsideProject(
  view: string,
  taskLists: readonly ListRef[],
  projectLists: readonly ListRef[] | null,
): string | null {
  if (projectLists === null || !view.startsWith("list:")) return null;
  const listId = view.slice(5);
  if (projectLists.some((list) => list.id === listId)) return null;
  if (!taskLists.some((list) => list.id === listId)) return null;
  const first = projectLists[0];
  return first ? `list:${first.id}` : DEFAULT_TASKS_VIEW;
}

/**
 * The Project filter in Tasks (#818 C3): the one place that narrows task lists.
 * `projectLists` is null for "All Projects"; `visibleLists` is what the sidebar shows.
 */
export function useTasksProjectScope(taskLists: TaskList[]) {
  const selectedProjectIds = useSelectedProjectIds();
  const projectLists = useMemo(
    () =>
      selectedProjectIds === null ? null : collectionsInProject(taskLists, selectedProjectIds),
    [selectedProjectIds, taskLists],
  );
  return { projectLists, visibleLists: projectLists ?? taskLists };
}

/** Leave a list view outside the selected Project for the Project's own list. */
export function useLeaveListOutsideProject(
  view: string,
  taskLists: readonly ListRef[],
  projectLists: readonly ListRef[] | null,
  followView: (view: string) => void,
): void {
  useEffect(() => {
    const next = tasksViewOutsideProject(view, taskLists, projectLists);
    if (next !== null && next !== view) followView(next);
  }, [followView, projectLists, taskLists, view]);
}

/** Close the open task when the selected Project does not hold its list. */
export function useCloseTaskOutsideProject(
  activeTask: Task | null,
  projectLists: readonly ListRef[] | null,
  closeTask: () => void,
): void {
  useEffect(() => {
    if (!activeTask || projectLists === null) return;
    if (!projectLists.some((list) => list.id === activeTask.taskListId)) closeTask();
  }, [activeTask, closeTask, projectLists]);
}
