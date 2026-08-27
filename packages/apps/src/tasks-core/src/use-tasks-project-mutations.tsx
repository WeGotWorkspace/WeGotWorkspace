import { useCallback, useState } from "react";
import { Tag } from "lucide-react";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import type { TaskProjectDialogConfirmInput } from "@/tasks-core/src/task-project-dialog";
import type { TaskProjectDialogState } from "@/tasks-core/src/task-project-dialog";
import { DEFAULT_TASKS_VIEW } from "@/tasks-core/src/tasks-route-search";
import {
  canChangeTaskListOwner,
  canShareTaskList,
  isProtectedTaskList,
  taskListDotColor,
} from "@/tasks-core/src/tasks-task-utils";
import type { TaskListPatch } from "@/tasks-core/src/tasks-types";
import type { TasksShellState } from "@/tasks-core/src/use-tasks-shell";

type UseTasksProjectMutationsArgs = {
  shell: TasksShellState;
};

export function useTasksProjectMutations({ shell }: UseTasksProjectMutationsArgs) {
  const { L, operations, taskLists, setTaskLists, selectView, view, show, showMutationError } =
    shell;
  const [projectDialog, setProjectDialog] = useState<TaskProjectDialogState>(null);

  const canManageProjects = Boolean(operations?.createTaskList && operations?.patchTaskList);

  const createProject = useCallback(
    async ({ name, color, groupSlug }: TaskProjectDialogConfirmInput) => {
      if (!operations?.createTaskList) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      try {
        const created = await operations.createTaskList({
          name: trimmed,
          ...(color?.trim() ? { color: color.trim() } : {}),
          ...(groupSlug?.trim() ? { groupSlug: groupSlug.trim() } : {}),
        });
        setTaskLists((prev) => [...prev, created]);
        selectView(`list:${created.id}`);
        show(L.toastProjectCreated);
        setProjectDialog(null);
      } catch {
        showMutationError(L.toastProjectSaveFailed);
      }
    },
    [L, operations, selectView, setTaskLists, show, showMutationError],
  );

  const updateProject = useCallback(
    async (listId: string, { name, color, groupSlug }: TaskProjectDialogConfirmInput) => {
      if (!operations?.patchTaskList) return;
      const trimmed = name.trim();
      const list = taskLists.find((entry) => entry.id === listId);
      if (!trimmed || !list) return;

      const patch: TaskListPatch = {};
      if (trimmed !== list.name) patch.name = trimmed;
      const displayColor = taskListDotColor({ id: list.id, color: list.color }).toLowerCase();
      const selectedColor = (color?.trim() || displayColor).toLowerCase();
      if (selectedColor !== displayColor) {
        patch.color = color?.trim() || null;
      }
      const nextGroupSlug = groupSlug !== undefined ? groupSlug?.trim() || null : undefined;
      const currentGroupSlug = list.groupSlug?.trim() || null;
      if (
        canChangeTaskListOwner(list) &&
        nextGroupSlug !== undefined &&
        nextGroupSlug !== currentGroupSlug
      ) {
        patch.groupSlug = nextGroupSlug;
      }

      if (Object.keys(patch).length === 0) {
        setProjectDialog(null);
        return;
      }

      try {
        const updated = await operations.patchTaskList(listId, patch);
        setTaskLists((prev) => prev.map((entry) => (entry.id === listId ? updated : entry)));
        show(L.toastProjectRenamed(trimmed), { icon: <Tag className="size-4" /> });
        setProjectDialog(null);
      } catch {
        showMutationError(L.toastProjectSaveFailed);
      }
    },
    [L, operations, setTaskLists, show, showMutationError, taskLists],
  );

  const patchShareWith = useCallback(
    async (listId: string, shareWith: CollectionShareWith) => {
      if (!operations?.patchTaskList) {
        throw new Error(L.shareListFailed);
      }
      try {
        const updated = await operations.patchTaskList(listId, {
          shareWith: shareWith as TaskListPatch["shareWith"],
        });
        setTaskLists((prev) => prev.map((entry) => (entry.id === listId ? updated : entry)));
        setProjectDialog((current) =>
          current?.mode === "edit" && current.listId === listId
            ? { ...current, shareWith: updated.shareWith ?? null }
            : current,
        );
      } catch (error) {
        showMutationError(L.shareListFailed);
        throw error;
      }
    },
    [L.shareListFailed, operations, setTaskLists, showMutationError],
  );

  const removeSharedList = useCallback(
    async (listId: string) => {
      if (!operations?.deleteTaskList) return;
      const list = taskLists.find((entry) => entry.id === listId);
      if (!list || isProtectedTaskList(list) || !list.isSharee) return;
      try {
        await operations.deleteTaskList(listId);
        setTaskLists((prev) => prev.filter((entry) => entry.id !== listId));
        if (view === `list:${listId}`) selectView(DEFAULT_TASKS_VIEW);
        show(L.toastListShareRemoved);
        setProjectDialog(null);
      } catch {
        showMutationError(L.toastProjectSaveFailed);
      }
    },
    [L, operations, selectView, setTaskLists, show, showMutationError, taskLists, view],
  );

  const openCreateProjectDialog = useCallback(() => {
    setProjectDialog({ mode: "create" });
  }, []);

  const openEditProjectDialog = useCallback(
    (listId: string) => {
      const list = taskLists.find((entry) => entry.id === listId);
      if (!list) return;
      setProjectDialog({
        mode: "edit",
        listId: list.id,
        name: list.name,
        color: list.color ?? null,
        scope: list.scope === "group" ? "group" : "personal",
        groupSlug: list.groupSlug ?? null,
        mayShare: canShareTaskList(list),
        isSharee: list.isSharee === true,
        shareWith: list.shareWith ?? null,
        canChangeOwner: canChangeTaskListOwner(list),
      });
    },
    [taskLists],
  );

  return {
    canManageProjects,
    projectDialog,
    setProjectDialog,
    openCreateProjectDialog,
    openEditProjectDialog,
    createProject,
    updateProject,
    patchShareWith,
    removeSharedList,
  };
}
