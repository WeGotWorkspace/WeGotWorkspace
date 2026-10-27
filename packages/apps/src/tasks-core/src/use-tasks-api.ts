import { useCallback, useMemo, useState } from "react";
import { createElement } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridTasksOperations,
  getTasksSyncRunner,
} from "@/lib/offline/tasks-hybrid-operations";
import { readTasksBootstrapFromCache } from "@/lib/offline/tasks-offline-store";
import {
  readOfflineTasksUsername,
  resolveTasksOfflineUsername,
} from "@/lib/offline/offline-session";
import { setTasksSyncConflictListener } from "@/lib/offline/tasks-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import type { TasksUIData } from "@/tasks-core/src/tasks-types";
import {
  createDefaultTasksApiSource,
  type TasksApiSource,
} from "@/tasks-core/src/tasks-api-source";

export type UseTasksAPIOptions = {
  onSyncConflict?: (taskIds: string[]) => void;
};

export function useTasksAPI(source?: TasksApiSource, options?: UseTasksAPIOptions) {
  const resolvedSource = useMemo(() => source ?? createDefaultTasksApiSource(), [source]);
  const placeholderData = useMemo<TasksUIData>(
    () => ({
      taskLists: [],
      tasks: [],
    }),
    [],
  );

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => {
    const username = readOfflineTasksUsername();
    if (!username) return null;
    return readTasksBootstrapFromCache(username);
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const [listRefreshing, setListRefreshing] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const { show, showError } = useAppToast();

  const operations = useMemo(() => {
    const fromSource = resolvedSource.createOperations(data ?? undefined);
    if (fromSource) return fromSource;
    const username = resolveTasksOfflineUsername(data?.session.user.username);
    if (!username) return undefined;
    return createHybridTasksOperations(username);
  }, [resolvedSource, data]);

  const offlineUsername = useMemo(
    () => resolveTasksOfflineUsername(data?.session.user.username),
    [data?.session.user.username],
  );

  useOfflineConflictQueue({
    setListener: setTasksSyncConflictListener,
    onConflicts: options?.onSyncConflict,
  });

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getTasksSyncRunner(offlineUsername).flush();
      const cached = await readTasksBootstrapFromCache(offlineUsername);
      if (cached) {
        patchBootstrap(() => cached);
        setBootstrapRevision((revision) => revision + 1);
      }
    },
  });

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void resolvedSource
      .loadBootstrap()
      .then((next) => {
        patchBootstrap(() => next);
        setBootstrapRevision((revision) => revision + 1);
        show(defaultTasksLabels.toastListUpdated, {
          icon: createElement(Check, { className: "size-4" }),
        });
      })
      .catch(() => {
        showError(defaultTasksLabels.toastListRefreshFailed);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [listRefreshing, patchBootstrap, resolvedSource, show, showError]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    // First paint only. A reconnect keeps the cached list and spins the refresh icon (#1532).
    listLoading: phase === "loading",
    listRefreshing: listRefreshing || reconnectSyncing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    offlineUsername,
  };
}
