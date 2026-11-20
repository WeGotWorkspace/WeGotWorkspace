import { useCallback, useEffect, useRef, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useContactsLiveInbound } from "@/lib/offline/contacts/use-contacts-live-inbound";
import {
  readContactsBootstrapFromCache,
  readContactsColdDownload,
} from "@/lib/offline/contacts/contacts-offline-store";
import {
  ensureContactsDownloaded,
  refreshCachedContacts,
} from "@/lib/offline/contacts/contacts-hybrid-operations";
import type { ContactCard } from "@/lib/models/contacts-types";

export type CalendarContactInviteesState = {
  cards: ContactCard[];
  refreshCards: () => void;
};

/**
 * Invitee suggestions come from the Contacts app's offline cache, which its
 * paced first download and live sync keep current. Calendar never downloads
 * the whole address book itself: that doubled the Contacts download as an
 * unpaced burst (shared hosting traffic budget). Without a cache the list
 * starts empty; teammates and a typed email still work.
 *
 * Typing in the invitee search re-reads the cache, which the Contacts live
 * inbound sync keeps current (mounted below, one syncing tab per browser).
 * When this browser has no complete contacts cache, a search starts (or
 * joins) the shared Contacts first download: paced, in large photo-less
 * pages, once for every app. Its pages show up as they land (the cache-changed
 * topic re-reads the cache); this resolves with the cards once it is done.
 */
export async function refreshCalendarContactCards(username: string): Promise<ContactCard[] | null> {
  const account = username.trim();
  if (!account) return null;
  const cached = await readContactsBootstrapFromCache(account);
  if (cached && !(await readContactsColdDownload(account))) return cached.data.cards;
  try {
    await ensureContactsDownloaded();
  } catch {
    // Keep what is cached; the next search tries again. Null means "do not replace".
    return null;
  }
  return (await readContactsBootstrapFromCache(account))?.data.cards ?? null;
}

export function useCalendarContactInvitees(username?: string): CalendarContactInviteesState {
  const [cards, setCards] = useState<ContactCard[]>([]);
  // A cache exists and its first download is finished, so sync tokens are stored.
  const [cacheComplete, setCacheComplete] = useState(false);
  const loadGen = useRef(0);
  const { online } = useConnectivity();
  const account = username?.trim() ?? "";

  const rereadCache = useCallback(async () => {
    if (!account) return;
    const cached = await readContactsBootstrapFromCache(account);
    if (cached) setCards(cached.data.cards);
  }, [account]);

  const readCacheState = useCallback(
    async (gen: number) => {
      const cached = await readContactsBootstrapFromCache(account);
      const coldDownload = cached ? await readContactsColdDownload(account) : null;
      if (loadGen.current !== gen) return;
      setCacheComplete(Boolean(cached) && !coldDownload);
      if (cached) setCards(cached.data.cards);
    },
    [account],
  );

  // The live adapter starts from the server's current state, not the stored
  // tokens: catch the cache up once, as the Contacts app does, then re-read it.
  useEffect(() => {
    if (!account || !cacheComplete || !online || !wgwLiveApiEnabled()) return;
    let cancelled = false;
    void refreshCachedContacts(account)
      .then(() => {
        if (!cancelled) return rereadCache();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account, cacheComplete, online, rereadCache]);

  // Keeps the cache current without a full download: a push or a /changes
  // round, run by one tab per browser. Needs a finished first download first.
  useContactsLiveInbound({
    username: account || null,
    enabled: cacheComplete && online && wgwLiveApiEnabled(),
    patchFromCache: rereadCache,
  });

  useEffect(() => {
    if (!account) {
      setCards([]);
      setCacheComplete(false);
      return;
    }
    const gen = ++loadGen.current;
    setCards([]);
    setCacheComplete(false);
    void readCacheState(gen);
  }, [account, readCacheState]);

  const refreshCards = useCallback(() => {
    if (!account) return;
    const gen = ++loadGen.current;
    // Contacts (maybe in another tab) may have written the cache since: pick it
    // up, and start the live sync once its first download is finished.
    void readCacheState(gen).then(async () => {
      if (loadGen.current !== gen) return;
      const next = await refreshCalendarContactCards(account);
      if (next == null || loadGen.current !== gen) return;
      setCards(next);
      // A first download may have just finished: start the live sync.
      await readCacheState(gen);
    });
  }, [account, readCacheState]);

  return { cards, refreshCards };
}
