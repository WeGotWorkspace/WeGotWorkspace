import { useCallback, useEffect, useMemo, useState } from "react";
import { createElement } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridTasksOperations,
  getTasksSyncRunner,
} from "@/lib/offline/tasks-hybrid-operations";
import { readTasksBootstrapFromCache } from "@/lib/offline/tasks-offline-store";
import {
  notifyTasksBootstrapUpdated,
  subscribeTasksBootstrapUpdated,
} from "@/lib/offline/tasks-bootstrap-sync";
import { syncTasksInbound, TASKS_INBOUND_POLL_MS } from "@/lib/offline/tasks-inbound-sync";
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
  const { online } = useConnectivity();
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

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const cached = await readTasksBootstrapFromCache(offlineUsername);
    if (cached) {
      patchBootstrap(() => cached);
      setBootstrapRevision((revision) => revision + 1);
    }
  }, [offlineUsername, patchBootstrap]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getTasksSyncRunner(offlineUsername).flush();
      if (wgwLiveApiEnabled()) {
        // Server changes made while offline land before the cache is re-read.
        // A failed pull leaves the cache as it is; the poll tries again.
        await syncTasksInbound(offlineUsername, { waitForLock: true }).catch(() => undefined);
      }
      await patchFromCache();
      notifyTasksBootstrapUpdated(offlineUsername);
    },
  });

  // Another tab pulled or flushed into the shared cache (#1815).
  useEffect(() => {
    if (!offlineUsername) return;
    return subscribeTasksBootstrapUpdated(offlineUsername, () => {
      void patchFromCache().catch(() => undefined);
    });
  }, [offlineUsername, patchFromCache]);

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (!wgwLiveApiEnabled()) return;
    const username = offlineUsername;
    let cancelled = false;
    const tick = () => {
      void syncTasksInbound(username)
        .then((result) => {
          if (!result?.changed) return;
          // The token is shared: the other tabs' next pull sees no change.
          notifyTasksBootstrapUpdated(username);
          if (!cancelled) return patchFromCache();
        })
        .catch(() => undefined);
    };
    const timer = setInterval(tick, TASKS_INBOUND_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [offlineUsername, online, patchFromCache, phase]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void resolvedSource
      .loadBootstrap()
      .then((next) => {
        patchBootstrap(() => next);
        setBootstrapRevision((revision) => revision + 1);
        if (offlineUsername) notifyTasksBootstrapUpdated(offlineUsername);
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
  }, [listRefreshing, offlineUsername, patchBootstrap, resolvedSource, show, showError]);

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
