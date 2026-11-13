import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createElement } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridNotesOperations,
  getNotesSyncRunner,
} from "@/lib/offline/notes/notes-hybrid-operations";
import {
  notifyNotesBootstrapUpdated,
  subscribeNotesBootstrapUpdated,
} from "@/lib/offline/notes/notes-bootstrap-sync";
import { syncNotesInboundFromRest } from "@/lib/offline/notes/notes-inbound-sync";
import { readNotesBootstrapFromCache } from "@/lib/offline/notes/notes-offline-store";
import {
  readOfflineNotesUsername,
  resolveNotesOfflineUsername,
} from "@/lib/offline/core/offline-session";
import { setNotesSyncConflictListener } from "@/lib/offline/notes/notes-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/core/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/core/use-offline-reconnect-flush";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  NOTES_CHANGES_POLL_MS,
  useNotesLiveInbound,
} from "@/notes-core/src/use-notes-live-inbound";
import type { NotesUIData } from "@/lib/models/notes-types";
import { createDefaultNotesApiSource, type NotesApiSource } from "./notes-api-source";
import { uploadPendingNoteBodies } from "./notes-pending-bodies";

export type UseNotesAPIOptions = {
  onSyncConflict?: (noteIds: string[]) => void;
};

export function useNotesAPI(source?: NotesApiSource, options?: UseNotesAPIOptions) {
  const { online } = useConnectivity();
  const resolvedSource = useMemo(() => source ?? createDefaultNotesApiSource(), [source]);
  const placeholderData = useMemo<NotesUIData>(
    () => ({
      notes: [],
      notebooks: [],
      tags: [],
    }),
    [],
  );

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => {
    const username = readOfflineNotesUsername();
    if (!username) return null;
    return readNotesBootstrapFromCache(username);
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const operations = useMemo(() => {
    const fromSource = resolvedSource.createOperations(data ?? undefined);
    if (fromSource) return fromSource;
    const username = resolveNotesOfflineUsername(data?.session.user.username);
    if (!username) return undefined;
    return createHybridNotesOperations(username);
  }, [resolvedSource, data]);

  const offlineUsername = useMemo(
    () => resolveNotesOfflineUsername(data?.session.user.username),
    [data?.session.user.username],
  );

  useOfflineConflictQueue({
    setListener: setNotesSyncConflictListener,
    onConflicts: options?.onSyncConflict,
  });

  const [listRefreshing, setListRefreshing] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const crossTabRefreshInFlightRef = useRef(false);
  const { show, showError } = useAppToast();

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const next = await readNotesBootstrapFromCache(offlineUsername);
    if (next) patchBootstrap(() => next);
    setBootstrapRevision((revision) => revision + 1);
  }, [offlineUsername, patchBootstrap]);

  const applyInboundRefresh = useCallback(async () => {
    if (!offlineUsername) return;
    const notebookIds = (data?.data.notebookCollections ?? []).map((item) => item.id);
    try {
      await syncNotesInboundFromRest(offlineUsername, notebookIds);
    } finally {
      // Another tab may have written the shared cache (an archive, a create).
      // Show it even when this tab cannot reach the server to sync.
      await patchFromCache();
    }
  }, [data?.data.notebookCollections, offlineUsername, patchFromCache]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void applyInboundRefresh()
      .then(() => {
        if (offlineUsername) notifyNotesBootstrapUpdated(offlineUsername);
        show(defaultNotesLabels.toastListUpdated, {
          icon: createElement(Check, { className: "size-4" }),
        });
      })
      .catch(() => {
        showError(defaultNotesLabels.toastListRefreshFailed);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [applyInboundRefresh, listRefreshing, offlineUsername, show, showError]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getNotesSyncRunner(offlineUsername).flush();
      await uploadPendingNoteBodies(offlineUsername);
      await applyInboundRefresh();
      notifyNotesBootstrapUpdated(offlineUsername);
    },
  });

  useEffect(() => {
    if (!offlineUsername) return;
    return subscribeNotesBootstrapUpdated(offlineUsername, () => {
      if (crossTabRefreshInFlightRef.current || reconnectSyncing || listRefreshing) return;
      crossTabRefreshInFlightRef.current = true;
      // Offline, only the shared cache can have changed: no /changes call.
      // Online, a failed sync is fine; applyInboundRefresh still re-reads it.
      const refresh = online ? applyInboundRefresh() : patchFromCache();
      void refresh
        .catch(() => undefined)
        .finally(() => {
          crossTabRefreshInFlightRef.current = false;
        });
    });
  }, [
    applyInboundRefresh,
    listRefreshing,
    offlineUsername,
    online,
    patchFromCache,
    reconnectSyncing,
  ]);

  const notebookCollectionsRef = useRef(data?.data.notebookCollections ?? []);
  notebookCollectionsRef.current = data?.data.notebookCollections ?? [];
  const livePollRunning = useNotesLiveInbound({
    username: offlineUsername,
    enabled: online && phase === "ready",
    notebooks: notebookCollectionsRef,
    patchFromCache,
  });

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (livePollRunning) return;

    let cancelled = false;

    const runSilentRefresh = () => {
      if (cancelled || listRefreshing || reconnectSyncing || crossTabRefreshInFlightRef.current) {
        return;
      }
      crossTabRefreshInFlightRef.current = true;
      void applyInboundRefresh().finally(() => {
        crossTabRefreshInFlightRef.current = false;
      });
    };

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      runSilentRefresh();
    }, NOTES_CHANGES_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    applyInboundRefresh,
    listRefreshing,
    livePollRunning,
    offlineUsername,
    online,
    phase,
    reconnectSyncing,
  ]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    syncing: reconnectSyncing,
    // First paint only. A reconnect keeps the cached list on screen and shows
    // the header refresh icon instead (#1532), same split as Contacts.
    listLoading: phase === "loading",
    listRefreshing: listRefreshing || reconnectSyncing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
