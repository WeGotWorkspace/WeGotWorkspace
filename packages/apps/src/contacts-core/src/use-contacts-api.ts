import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { createContactsJmapClient } from "@/lib/api/wgw/contacts";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapContactsAdapter, type JmapAddressBook, type JmapContactCard } from "@/lib/jmap-client";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridContactsOperations,
  getContactsSyncRunner,
} from "@/lib/offline/contacts-hybrid-operations";
import {
  ingestRemoteAddressBook,
  ingestRemoteAddressBookDestroyed,
  ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed,
  reconcileContactsSnapshot,
} from "@/lib/offline/contacts-jmap-inbound";
import { readContactsBootstrapFromCache } from "@/lib/offline/contacts-offline-store";
import {
  readOfflineContactsUsername,
  resolveContactsOfflineUsername,
} from "@/lib/offline/offline-session";
import { setContactsSyncConflictListener } from "@/lib/offline/contacts-sync-conflicts";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import type { AddressBook, ContactCard, ContactsUIData } from "@/contacts-core/src/contacts-types";
import { createDefaultContactsApiSource, type ContactsApiSource } from "./contacts-api-source";

/** Live JMAP inbound poll (adapter owns the timer). */
const ONLINE_CHANGES_POLL_MS = 10_000;

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

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => {
    const username = readOfflineContactsUsername();
    if (!username) return null;
    return readContactsBootstrapFromCache(username);
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const operations = useMemo(() => {
    const fromSource = resolvedSource.createOperations(data ?? undefined);
    if (fromSource) return fromSource;
    const username = resolveContactsOfflineUsername(data?.session.user.username);
    if (!username) return undefined;
    return createHybridContactsOperations(username);
  }, [resolvedSource, data]);

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

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const next = await readContactsBootstrapFromCache(offlineUsername);
    if (next) patchBootstrap(() => next);
  }, [offlineUsername, patchBootstrap]);

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (!wgwLiveApiEnabled()) return;

    const username = offlineUsername;
    const adapter = new JmapContactsAdapter({
      client: createContactsJmapClient(),
      onRemoteContactCard: (card: JmapContactCard) => {
        void ingestRemoteContactCard(username, card as ContactCard).then(() => {
          void patchFromCache();
        });
      },
      onRemoteContactCardDestroyed: (cardId) => {
        void ingestRemoteContactCardDestroyed(username, cardId).then(() => {
          void patchFromCache();
        });
      },
      onRemoteAddressBook: (book: JmapAddressBook) => {
        void ingestRemoteAddressBook(username, book as AddressBook).then(() => {
          void patchFromCache();
        });
      },
      onRemoteAddressBookDestroyed: (bookId) => {
        void ingestRemoteAddressBookDestroyed(username, bookId).then(() => {
          void patchFromCache();
        });
      },
      onRefetchAll: ({ books, cards }) => {
        void reconcileContactsSnapshot(
          username,
          cards as ContactCard[],
          books as AddressBook[],
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
        // Session missing contacts capability — Dexie cache still renders.
      });

    return () => {
      cancelled = true;
      adapter.stopPolling();
    };
  }, [offlineUsername, online, patchFromCache, phase]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void resolvedSource
      .loadBootstrap()
      .then((next) => {
        patchBootstrap(() => next);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [listRefreshing, patchBootstrap, resolvedSource]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    listLoading: phase === "loading" || listRefreshing || reconnectSyncing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
