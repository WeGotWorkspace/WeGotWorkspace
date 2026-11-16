import { useEffect, useRef, useState } from "react";
import { createContactsJmapClient } from "@/lib/api/wgw/contacts";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { JmapContactsAdapter } from "@/lib/jmap-client";
import {
  ingestRemoteAddressBook,
  ingestRemoteAddressBookDestroyed,
  ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed,
  reconcileContactsSnapshot,
} from "@/lib/offline/contacts/contacts-jmap-inbound";
import type { AddressBook, ContactCard } from "@/lib/models/contacts-types";

/** Inbound `/changes` poll while push is down. */
export const CONTACTS_CHANGES_POLL_MS = 10_000;
/** While push is connected the poll only backs it up. */
export const CONTACTS_CHANGES_PUSH_POLL_MS = 60_000;

const PUSH_TYPES = ["AddressBook", "ContactCard"] as const;
const NO_TYPES: readonly string[] = [];

type UseContactsLiveInboundArgs = {
  /** Account of the offline cache; null until the bootstrap knows it. */
  username: string | null;
  /** Online, bootstrapped and on the live API: the inbound sync may run. */
  enabled: boolean;
  /** Re-read the cache into the list after an ingest. */
  patchFromCache: () => Promise<void>;
};

/**
 * Live inbound Contacts sync over JMAP (#1666): a push for `ContactCard` or
 * `AddressBook` runs one `/changes` round when the pushed state differs from
 * the adapter's own; the poll backs it up every 10 s, or every 60 s while
 * push is connected. Without the contacts capability the Dexie cache still
 * renders and nothing syncs inbound.
 */
export function useContactsLiveInbound({
  username,
  enabled,
  patchFromCache,
}: UseContactsLiveInboundArgs): void {
  const [adapter, setAdapter] = useState<JmapContactsAdapter | null>(null);
  const latestPatch = useRef(patchFromCache);
  useEffect(() => {
    latestPatch.current = patchFromCache;
  }, [patchFromCache]);

  useEffect(() => {
    if (!username || !enabled) return;
    if (typeof window === "undefined" || !wgwLiveApiEnabled()) return;

    const ingested = (work: Promise<unknown>) => void work.then(() => latestPatch.current());
    const next = new JmapContactsAdapter({
      client: createContactsJmapClient(),
      onRemoteContactCard: (card) =>
        ingested(ingestRemoteContactCard(username, card as ContactCard)),
      onRemoteContactCardDestroyed: (cardId) =>
        ingested(ingestRemoteContactCardDestroyed(username, cardId)),
      onRemoteAddressBook: (book) =>
        ingested(ingestRemoteAddressBook(username, book as AddressBook)),
      onRemoteAddressBookDestroyed: (bookId) =>
        ingested(ingestRemoteAddressBookDestroyed(username, bookId)),
      onRefetchAll: ({ books, cards }) =>
        ingested(
          reconcileContactsSnapshot(username, cards as ContactCard[], books as AddressBook[]),
        ),
      onSyncError: (error: unknown) => console.warn("[contacts] live inbound sync failed", error),
    });

    let cancelled = false;
    void next
      .initialize()
      .then(() => {
        if (!cancelled) setAdapter(next);
      })
      .catch(() => {
        // Session without the contacts capability: the Dexie cache still renders.
      });

    return () => {
      cancelled = true;
      next.stopPolling();
      setAdapter(null);
    };
  }, [enabled, username]);

  const pushConnected = useJmapPushConnected();
  useEffect(() => {
    if (!adapter) return;
    adapter.startPolling(pushConnected ? CONTACTS_CHANGES_PUSH_POLL_MS : CONTACTS_CHANGES_POLL_MS);
    return () => adapter.stopPolling();
  }, [adapter, pushConnected]);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : true,
  );
}
