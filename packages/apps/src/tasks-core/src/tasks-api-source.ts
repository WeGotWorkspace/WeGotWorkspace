import { createTasksAppBootstrap, type TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type {
  Task,
  TaskList,
  TaskListPatch,
  TasksAPIOperations,
} from "@/tasks-core/src/tasks-types";
import { taskAlertsFromList } from "@/tasks-core/src/tasks-task-utils";
import {
  filterSharePrincipals,
  mergeShareWith,
  sharePrincipalsFromDirectory,
} from "@/share-ui/collection-share";
import {
  createHybridTasksOperations,
  loadTasksBootstrapHybrid,
} from "@/lib/offline/tasks-hybrid-operations";
import { resolveTasksOfflineUsername } from "@/lib/offline/offline-session";

function taskListAfterSharePatch(list: TaskList, patch: TaskListPatch): TaskList {
  const { shareWith, ...rest } = patch;
  return {
    ...list,
    ...rest,
    ...(shareWith !== undefined
      ? { shareWith: mergeShareWith(list.shareWith, shareWith ?? {}) as TaskList["shareWith"] }
      : {}),
  };
}

export type TasksApiSource = {
  loadBootstrap: () => Promise<TasksAppBootstrap>;
  createOperations: (bootstrap?: TasksAppBootstrap) => TasksAPIOperations | undefined;
};

function createMockTasksOperations(
  getBootstrap: () => TasksAppBootstrap,
  setBootstrap: (next: TasksAppBootstrap) => void,
): TasksAPIOperations {
  const updateTasks = (updater: (tasks: Task[]) => Task[]) => {
    const current = getBootstrap();
    setBootstrap({
      ...current,
      data: { ...current.data, tasks: updater(current.data.tasks) },
    });
  };

  const updateTaskLists = (updater: (lists: TaskList[]) => TaskList[]) => {
    const current = getBootstrap();
    setBootstrap({
      ...current,
      data: { ...current.data, taskLists: updater(current.data.taskLists) },
    });
  };

  return {
    createTask: async (body) => {
      const listId = Object.keys(body.taskListIds).find((id) => body.taskListIds[id]) ?? "default";
      const existingTasks = getBootstrap().data.tasks;
      const sortOrder =
        existingTasks
          .filter((task) => task.taskListId === listId)
          .reduce((max, task) => Math.max(max, task.sortOrder ?? 0), -1) + 1;
      const created: Task = {
        "@type": "Task",
        id: `task-${Date.now()}`,
        taskListId: listId,
        uid: `urn:uuid:${crypto.randomUUID()}`,
        title: body.title,
        description: body.description ?? null,
        due: body.due ?? null,
        workflowStatus: body.workflowStatus ?? "needs-action",
        priority: body.priority ?? null,
        isDraft: false,
        sortOrder,
        categories: body.categories ?? [],
        alerts: body.alerts
          ? taskAlertsFromList(
              Array.isArray(body.alerts) ? body.alerts : Object.values(body.alerts),
            )
          : undefined,
      };
      updateTasks((tasks) => [...tasks, created]);
      return created;
    },
    patchTask: async (taskId, patch) => {
      let updated: Task | null = null;
      updateTasks((tasks) =>
        tasks.map((task) => {
          if (task.id !== taskId) return task;
          const listId =
            patch && "taskListId" in patch && typeof patch.taskListId === "string"
              ? patch.taskListId
              : task.taskListId;
          updated = {
            ...task,
            ...patch,
            taskListId: listId,
            categories: patch.categories ?? task.categories,
            alerts: patch.alerts !== undefined ? (patch.alerts ?? undefined) : task.alerts,
          };
          return updated;
        }),
      );
      if (!updated) throw new Error("Task not found");
      return updated;
    },
    deleteTask: async (taskId) => {
      updateTasks((tasks) => tasks.filter((task) => task.id !== taskId));
    },
    moveTaskToList: async (taskId, taskListId) => {
      let updated: Task | null = null;
      updateTasks((tasks) =>
        tasks.map((task) => {
          if (task.id !== taskId) return task;
          updated = { ...task, taskListId };
          return updated;
        }),
      );
      if (!updated) throw new Error("Task not found");
      return updated;
    },
    createTaskList: async (body) => {
      const created: TaskList = {
        id: `list-${Date.now()}`,
        name: body.name,
        color: body.color ?? null,
        scope: body.groupSlug ? "group" : "personal",
        groupSlug: body.groupSlug ?? null,
        isDefault: false,
        sortOrder: getBootstrap().data.taskLists.length,
        isSubscribed: true,
        isSharee: false,
        myRights: {
          mayReadItems: true,
          mayWriteAll: true,
          mayWriteOwn: true,
          mayUpdatePrivate: true,
          mayRSVP: true,
          mayAdmin: true,
          mayDelete: true,
          mayShare: true,
        },
      };
      updateTaskLists((lists) => [...lists, created]);
      return created;
    },
    patchTaskList: async (taskListId, patch) => {
      let updated: TaskList | null = null;
      updateTaskLists((lists) =>
        lists.map((list) => {
          if (list.id !== taskListId) return list;
          const next = taskListAfterSharePatch(list, patch);
          updated = next;
          return next;
        }),
      );
      if (!updated) throw new Error("Task list not found");
      return updated;
    },
    searchSharePrincipals: async (query) => {
      const bootstrap = getBootstrap();
      return filterSharePrincipals(
        query,
        sharePrincipalsFromDirectory({
          groups: bootstrap.data.groups,
          excludeId: bootstrap.session.user.username,
        }),
      );
    },
    deleteTaskList: async (taskListId, opts) => {
      updateTaskLists((lists) => lists.filter((list) => list.id !== taskListId));
      if (opts?.onDestroyRemoveContents) {
        updateTasks((tasks) => tasks.filter((task) => task.taskListId !== taskListId));
      }
    },
  };
}

export function createHybridTasksApiSource(): TasksApiSource {
  return {
    loadBootstrap: loadTasksBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveTasksOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      return createHybridTasksOperations(username);
    },
  };
}

export function createDefaultTasksApiSource(): TasksApiSource {
  let mockBootstrap = createTasksAppBootstrap();

  return createWorkspaceSource<TasksApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(mockBootstrap),
      createOperations: (bootstrap) => {
        const username = resolveTasksOfflineUsername(bootstrap?.session.user.username);
        if (username) return createHybridTasksOperations(username);
        return createMockTasksOperations(
          () => mockBootstrap,
          (next) => {
            mockBootstrap = next;
          },
        );
      },
    }),
    createLiveSource: createHybridTasksApiSource,
  });
}
