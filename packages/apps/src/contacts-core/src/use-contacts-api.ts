import { useCallback, useEffect, useMemo, useState } from "react";
import { createElement } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridContactsOperations,
  getContactsSyncRunner,
  loadContactsBootstrapForBoot,
  readContactsCacheForBoot,
  refreshCachedContacts,
} from "@/lib/offline/contacts-hybrid-operations";
import { readContactsBootstrapFromCache } from "@/lib/offline/contacts-offline-store";
import {
  readOfflineContactsUsername,
  resolveContactsOfflineUsername,
} from "@/lib/offline/core/offline-session";
import { setContactsSyncConflictListener } from "@/lib/offline/contacts-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/core/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/core/use-offline-reconnect-flush";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type { ContactsUIData } from "@/lib/models/contacts-types";
import { createDefaultContactsApiSource, type ContactsApiSource } from "./contacts-api-source";
import { useContactsLiveInbound } from "./use-contacts-live-inbound";

export type UseContactsAPIOptions = {
  onSyncConflict?: (cardIds: string[]) => void;
};

export function useContactsAPI(source?: ContactsApiSource, options?: UseContactsAPIOptions) {
  const { online } = useConnectivity();
  const resolvedSource = useMemo(() => source ?? createDefaultContactsApiSource(), [source]);
  const placeholderData = useMemo<ContactsUIData>(
    () => ({
      addressBooks: [],
      cards: [],
    }),
    [],
  );

  const runBootstrap = useCallback(
    (reportProgress?: (partial: ContactsAppBootstrap) => void) => {
      if (!wgwLiveApiEnabled()) return resolvedSource.loadBootstrap();
      return loadContactsBootstrapForBoot(reportProgress);
    },
    [resolvedSource],
  );
  const readCache = useCallback(async () => {
    const username = readOfflineContactsUsername();
    if (!username) return null;
    return readContactsCacheForBoot(username);
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap, complete } = useHybridBootstrap(
    {
      load: runBootstrap,
      readCache,
    },
  );

  /** First page is on screen; later pages are still downloading. */
  const coldDownload = phase === "ready" && !complete;

  const operations = useMemo(() => {
    if (coldDownload) return undefined;
    const fromSource = resolvedSource.createOperations(data ?? undefined);
    if (fromSource) return fromSource;
    const username = resolveContactsOfflineUsername(data?.session.user.username);
    if (!username) return undefined;
    return createHybridContactsOperations(username);
  }, [coldDownload, resolvedSource, data]);

  const offlineUsername = useMemo(
    () => resolveContactsOfflineUsername(data?.session.user.username),
    [data?.session.user.username],
  );

  useOfflineConflictQueue({
    setListener: setContactsSyncConflictListener,
    onConflicts: options?.onSyncConflict,
  });

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getContactsSyncRunner(offlineUsername).flush();
      const cached = await readContactsBootstrapFromCache(offlineUsername);
      if (cached) patchBootstrap(() => cached);
    },
  });

  const [listRefreshing, setListRefreshing] = useState(false);
  const { show, showError } = useAppToast();

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const next = await readContactsBootstrapFromCache(offlineUsername);
    if (next) patchBootstrap(() => next);
  }, [offlineUsername, patchBootstrap]);

  useEffect(() => {
    // First page sets phase ready while later pages are still downloading.
    // Refresh only once that snapshot (and its sync tokens) is finished.
    if (!offlineUsername || !online || phase !== "ready" || !complete) return;
    if (!wgwLiveApiEnabled()) return;
    let cancelled = false;
    void refreshCachedContacts(offlineUsername)
      .then(() => {
        if (!cancelled) return patchFromCache();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [complete, offlineUsername, online, patchFromCache, phase]);

  useContactsLiveInbound({
    username: offlineUsername,
    // Refresh only once the first download (and its sync tokens) is finished.
    enabled: online && phase === "ready" && complete,
    patchFromCache,
  });

  const refreshList = useCallback(() => {
    if (listRefreshing || coldDownload) return;
    setListRefreshing(true);
    void resolvedSource
      .loadBootstrap()
      .then((next) => {
        patchBootstrap(() => next);
        show(defaultContactsLabels.toastListUpdated, {
          icon: createElement(Check, { className: "size-4" }),
        });
      })
      .catch(() => {
        showError(defaultContactsLabels.toastListRefreshFailed);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [coldDownload, listRefreshing, patchBootstrap, resolvedSource, show, showError]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    // First paint only. Refresh / reconnect keep cached cards and use listRefreshing
    // (header icon) — same split as Notes.
    listLoading: phase === "loading",
    listRefreshing: listRefreshing || reconnectSyncing || coldDownload,
    /** Cold download: list is visible but create, edit, and delete stay closed. */
    mutationsLocked: coldDownload,
    /** Non-group cards the cold download has not fetched yet; undefined when none is running or it is unknown. */
    pendingContactCount: coldDownload ? data?.pendingContactCount : undefined,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
