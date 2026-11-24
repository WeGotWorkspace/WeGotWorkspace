import { useEffect, useRef, useState } from "react";
import { createContactsJmapClient } from "@/lib/api/wgw/contacts";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { usePushBackupPoll } from "@/lib/live/use-push-backup-poll";
import { useSharedInboundSync } from "@/lib/api/wgw/use-shared-inbound-sync";
import { JmapContactsAdapter } from "@/lib/jmap-client";
import {
  ingestRemoteAddressBook,
  ingestRemoteAddressBookDestroyed,
  ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed,
  reconcileContactsSnapshot,
} from "@/lib/offline/contacts/contacts-jmap-inbound";
import { subscribeContactsCacheChanged } from "@/lib/offline/contacts/contacts-cache-changed";
import type { AddressBook, ContactCard } from "@/lib/models/contacts-types";

/** Backup `/changes` poll while push is not healthy. */
export const CONTACTS_CHANGES_POLL_MS = 10_000;

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
 * the adapter's own; the poll backs it up every 10 s, only while
 * push is not healthy. One tab per browser does this; the others re-read the
 * cache it writes (#2252). Without the contacts capability the Dexie cache still
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

    const ingested = (work: Promise<unknown>) => {
      next.ingesting(work);
      void work.then(() => latestPatch.current());
    };
    const next: JmapContactsAdapter = new JmapContactsAdapter({
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

  useSharedInboundSync(adapter, "contacts", username, () => void latestPatch.current());

  // Photos and pages saved outside this view, in any tab. Not while this tab's
  // own first download runs: its progress keeps the whole book's count in the
  // header, which a plain re-read of the cache would replace with a climbing one.
  useEffect(() => {
    if (!username || !enabled) return;
    return subscribeContactsCacheChanged(username, () => void latestPatch.current());
  }, [enabled, username]);

  usePushBackupPoll(adapter, CONTACTS_CHANGES_POLL_MS);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : true,
  );
}
