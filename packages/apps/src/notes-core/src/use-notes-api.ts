import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { createNotesJmapClient } from "@/lib/api/wgw/notes-jmap";
import { noteFromVjournal, type NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapNotesAdapter, type JmapNote, type JmapNotebook } from "@/lib/jmap-client";
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
import {
  ingestRemoteNote,
  ingestRemoteNoteDestroyed,
  ingestRemoteNotebook,
  ingestRemoteNotebookDestroyed,
  reconcileNotesSnapshot,
} from "@/lib/offline/notes-jmap-inbound";
import { syncNotesInboundFromRest } from "@/lib/offline/notes-inbound-sync";
import { readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import {
  readOfflineNotesUsername,
  resolveNotesOfflineUsername,
} from "@/lib/offline/offline-session";
import { setNotesSyncConflictListener } from "@/lib/offline/notes-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import type { NotesNotebookCollection, NotesUIData } from "@/notes-core/src/notes-types";
import { createDefaultNotesApiSource, type NotesApiSource } from "./notes-api-source";

/** Inbound `/changes` poll — not a full-body listNotes loop. */
const ONLINE_CHANGES_POLL_MS = 10_000;

export type UseNotesAPIOptions = {
  onSyncConflict?: (noteIds: string[]) => void;
};

function jmapNotebookToCollection(notebook: JmapNotebook): NotesNotebookCollection {
  return {
    id: notebook.id,
    name: notebook.name,
    color: notebook.color,
    isDefault: notebook.isDefault,
    isSharee: notebook.isSharee,
    groupSlug: notebook.groupSlug,
    scope: notebook.scope,
    myRights: notebook.myRights ?? null,
    shareWith: (notebook.shareWith ?? null) as NotesNotebookCollection["shareWith"],
  };
}

function jmapNoteToVjournal(note: JmapNote): NotesVjournalNote {
  return {
    id: note.id,
    notebookId: note.notebookId,
    title: note.title ?? null,
    body: note.body ?? "",
    categories: note.categories ?? [],
    status: note.status ?? null,
    etag: note.etag ?? "",
    starred: note.starred,
    updatedAt: note.updatedAt,
    contentUpdatedAt: note.contentUpdatedAt,
  };
}

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

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const next = await readNotesBootstrapFromCache(offlineUsername);
    if (next) patchBootstrap(() => next);
    setBootstrapRevision((revision) => revision + 1);
  }, [offlineUsername, patchBootstrap]);

  const applyInboundRefresh = useCallback(async () => {
    if (!offlineUsername) return;
    const notebookIds = (data?.data.notebookCollections ?? []).map((item) => item.id);
    await syncNotesInboundFromRest(offlineUsername, notebookIds);
    await patchFromCache();
  }, [data?.data.notebookCollections, offlineUsername, patchFromCache]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void applyInboundRefresh()
      .then(() => {
        if (offlineUsername) notifyNotesBootstrapUpdated(offlineUsername);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [applyInboundRefresh, listRefreshing, offlineUsername]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getNotesSyncRunner(offlineUsername).flush();
      await applyInboundRefresh();
      const next = await readNotesBootstrapFromCache(offlineUsername);
      if (next) {
        await syncNotesBodiesForOffline(offlineUsername, next.data.notes).catch(() => undefined);
      }
      notifyNotesBootstrapUpdated(offlineUsername);
    },
  });

  useEffect(() => {
    if (!offlineUsername) return;
    return subscribeNotesBootstrapUpdated(offlineUsername, () => {
      if (crossTabRefreshInFlightRef.current || reconnectSyncing || listRefreshing) return;
      crossTabRefreshInFlightRef.current = true;
      void applyInboundRefresh().finally(() => {
        crossTabRefreshInFlightRef.current = false;
      });
    });
  }, [applyInboundRefresh, listRefreshing, offlineUsername, reconnectSyncing]);

  useEffect(() => {
    const notes = data?.data.notes ?? [];
    if (phase !== "ready" || !offlineUsername || notes.length === 0) return;
    void syncNotesBodiesForOffline(offlineUsername, notes).catch(() => undefined);
  }, [data?.data.notes, offlineUsername, phase]);

  const notebookCollectionsRef = useRef(data?.data.notebookCollections ?? []);
  notebookCollectionsRef.current = data?.data.notebookCollections ?? [];

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (!wgwLiveApiEnabled()) return;

    const username = offlineUsername;
    const mapNote = (note: JmapNote) =>
      noteFromVjournal(jmapNoteToVjournal(note), notebookCollectionsRef.current);
    const adapter = new JmapNotesAdapter({
      client: createNotesJmapClient(),
      onRemoteNote: (note) => {
        void ingestRemoteNote(username, mapNote(note)).then(() => {
          void patchFromCache();
        });
      },
      onRemoteNoteDestroyed: (noteId) => {
        void ingestRemoteNoteDestroyed(username, noteId).then(() => {
          void patchFromCache();
        });
      },
      onRemoteNotebook: (notebook: JmapNotebook) => {
        void ingestRemoteNotebook(username, jmapNotebookToCollection(notebook)).then(() => {
          void patchFromCache();
        });
      },
      onRemoteNotebookDestroyed: (notebookId) => {
        void ingestRemoteNotebookDestroyed(username, notebookId).then(() => {
          void patchFromCache();
        });
      },
      onRefetchAll: ({ notebooks, notes }) => {
        void reconcileNotesSnapshot(
          username,
          notes.map(mapNote),
          notebooks.map(jmapNotebookToCollection),
        ).then(() => {
          void patchFromCache();
        });
      },
    });

    let cancelled = false;
    void adapter
      .initialize()
      .then(() => {
        if (cancelled) return;
        adapter.startPolling(ONLINE_CHANGES_POLL_MS);
      })
      .catch(() => {
        // Session missing notes capability or offline — REST inbound still runs below.
      });

    return () => {
      cancelled = true;
      adapter.stopPolling();
    };
  }, [offlineUsername, online, patchFromCache, phase]);

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (wgwLiveApiEnabled()) return;

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
    }, ONLINE_CHANGES_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applyInboundRefresh, listRefreshing, offlineUsername, online, phase, reconnectSyncing]);

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
