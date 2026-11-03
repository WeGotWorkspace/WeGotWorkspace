import { useCallback, useMemo, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useParkedWrites } from "@/lib/offline/core/use-parked-writes";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { rescueParkedTasks, type TaskRescueTarget } from "@/lib/offline/tasks/tasks-parked-writes";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { canWriteTaskList } from "@/tasks-core/src/tasks-task-utils";
import type { Task, TaskList, TasksAPIOperations } from "@/tasks-core/src/tasks-types";

type UseTasksRescueArgs = {
  username: string | null;
  operations?: TasksAPIOperations;
  taskLists: TaskList[];
  reloadFromCache: () => Promise<void>;
};

/**
 * Tasks' side of the parked writes (#1825): which lists a task can go to, and
 * what moving or discarding them does. The parked store and the one-tab dialog
 * are shared (`useParkedWrites`), so other apps can reuse them for #1565.
 */
export function useTasksRescue({
  username,
  operations,
  taskLists,
  reloadFromCache,
}: UseTasksRescueArgs) {
  const { writes, open, openDialog, closeDialog, take, claim } = useParkedWrites<Task>(
    username,
    TASKS_DOMAIN,
  );
  const [busy, setBusy] = useState(false);
  const { show, showError } = useAppToast();
  // A list a parked write came from just refused it, even before the cache knows.
  const writableLists = useMemo(() => {
    const refused = new Set(writes.map((write) => write.containerId));
    return taskLists.filter((list) => canWriteTaskList(list) && !refused.has(list.id));
  }, [taskLists, writes]);

  const settle = useCallback(
    (work: () => Promise<void>) => {
      setBusy(true);
      void work()
        .catch(() => showError(L.rescueFailed))
        .finally(async () => {
          setBusy(false);
          await reloadFromCache().catch(() => undefined);
          if (username) notifyTasksBootstrapUpdated(username);
        });
    },
    [reloadFromCache, showError, username],
  );

  const move = useCallback(
    (ids: string[], target: TaskRescueTarget) =>
      settle(async () => {
        if (!username || !operations) return;
        const claimed = await claim(ids);
        try {
          const taken = claimed.writes;
          if (taken.length === 0) return;
          // Failed creates are parked again inside; created ones leave the claim one by one.
          const { listId } = await rescueParkedTasks(username, taken, target, operations, (write) =>
            claimed.settle([write.id]),
          );
          const name =
            "newListName" in target
              ? target.newListName
              : (writableLists.find((list) => list.id === listId)?.name ?? "");
          show(L.rescueMoved(taken.length, name));
        } finally {
          claimed.release();
        }
      }),
    [claim, operations, settle, show, username, writableLists],
  );

  const discard = useCallback(
    (ids: string[]) =>
      settle(async () => {
        const taken = await take(ids);
        if (taken.length > 0) show(L.rescueDiscarded(taken.length));
      }),
    [settle, show, take],
  );

  const openFromEntry = useCallback(() => {
    void openDialog().then((opened) => {
      if (!opened) show(L.rescueOpenElsewhere);
    });
  }, [openDialog, show]);

  return { writes, open, busy, writableLists, move, discard, later: closeDialog, openFromEntry };
}
