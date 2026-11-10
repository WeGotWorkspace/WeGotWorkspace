import { useCallback, useMemo } from "react";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { tasksRescueOperations } from "@/lib/offline/tasks/tasks-parked-writes";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import type { RescueAdapter } from "@/rescue-ui/rescue-adapter";
import { useContainerRescue } from "@/rescue-ui/use-container-rescue";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { tasksRescueView } from "@/tasks-core/src/tasks-rescue-view";
import { canWriteTaskList } from "@/tasks-core/src/tasks-task-utils";
import type { Task, TaskList, TasksAPIOperations } from "@/lib/models/tasks-types";

type UseTasksRescueArgs = {
  username: string | null;
  operations?: TasksAPIOperations;
  taskLists: TaskList[];
  reloadFromCache: () => Promise<void>;
};

/**
 * Tasks' adapter for the shared rescue (#1825, #1565): task lists as the
 * containers, and a reread of the cache that the other Tasks tabs hear.
 */
export function useTasksRescue({
  username,
  operations,
  taskLists,
  reloadFromCache,
}: UseTasksRescueArgs) {
  const afterSettle = useCallback(async () => {
    await reloadFromCache().catch(() => undefined);
    if (username) notifyTasksBootstrapUpdated(username);
  }, [reloadFromCache, username]);

  const adapter = useMemo<RescueAdapter<Task, TaskList>>(
    () => ({
      ...tasksRescueView(defaultTasksLabels),
      domain: TASKS_DOMAIN,
      containers: taskLists,
      canWrite: canWriteTaskList,
      operations: operations ? tasksRescueOperations(operations) : undefined,
      afterSettle,
    }),
    [afterSettle, operations, taskLists],
  );

  const { writableContainers, ...rescue } = useContainerRescue(username, adapter);
  return { ...rescue, writableLists: writableContainers };
}
