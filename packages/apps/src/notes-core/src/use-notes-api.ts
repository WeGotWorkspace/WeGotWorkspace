import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridNotesOperations,
  getNotesSyncRunner,
} from "@/lib/offline/notes-hybrid-operations";
import {
  notifyNotesBootstrapUpdated,
  subscribeNotesBootstrapUpdated,
} from "@/lib/offline/notes-bootstrap-sync";
import { syncNotesBodiesForOffline } from "@/lib/offline/notes/notes-body-sync";
import { readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import {
  readOfflineNotesUsername,
  resolveNotesOfflineUsername,
} from "@/lib/offline/offline-session";
import { setNotesSyncConflictListener } from "@/lib/offline/notes-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import type { NotesUIData } from "@/notes-core/src/notes-types";
import { createDefaultNotesApiSource, type NotesApiSource } from "./notes-api-source";

/** Full bootstrap fetch while online — lighter than pending-sync badge polls. */
const ONLINE_BOOTSTRAP_POLL_MS = 10_000;

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

  const applyBootstrapRefresh = useCallback(async () => {
    const next = await resolvedSource.loadBootstrap();
    patchBootstrap(() => next);
    setBootstrapRevision((revision) => revision + 1);
    return next;
  }, [patchBootstrap, resolvedSource]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void applyBootstrapRefresh()
      .then(() => {
        if (offlineUsername) notifyNotesBootstrapUpdated(offlineUsername);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [applyBootstrapRefresh, listRefreshing, offlineUsername]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getNotesSyncRunner(offlineUsername).flush();
      const next = await applyBootstrapRefresh();
      await syncNotesBodiesForOffline(offlineUsername, next.data.notes).catch(() => undefined);
      notifyNotesBootstrapUpdated(offlineUsername);
    },
  });

  useEffect(() => {
    if (!offlineUsername) return;
    return subscribeNotesBootstrapUpdated(offlineUsername, () => {
      if (crossTabRefreshInFlightRef.current || reconnectSyncing || listRefreshing) return;
      crossTabRefreshInFlightRef.current = true;
      void applyBootstrapRefresh().finally(() => {
        crossTabRefreshInFlightRef.current = false;
      });
    });
  }, [applyBootstrapRefresh, listRefreshing, offlineUsername, reconnectSyncing]);

  useEffect(() => {
    const notes = data?.data.notes ?? [];
    if (phase !== "ready" || !offlineUsername || notes.length === 0) return;
    void syncNotesBodiesForOffline(offlineUsername, notes).catch(() => undefined);
  }, [data?.data.notes, offlineUsername, phase]);

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const runSilentRefresh = () => {
      if (cancelled || listRefreshing || reconnectSyncing || crossTabRefreshInFlightRef.current) {
        return;
      }
      crossTabRefreshInFlightRef.current = true;
      void applyBootstrapRefresh().finally(() => {
        crossTabRefreshInFlightRef.current = false;
      });
    };

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      runSilentRefresh();
    }, ONLINE_BOOTSTRAP_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applyBootstrapRefresh, listRefreshing, offlineUsername, online, phase, reconnectSyncing]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    syncing: reconnectSyncing,
    listLoading: phase === "loading" || reconnectSyncing,
    listRefreshing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
