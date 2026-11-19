import { useCallback, useEffect, useRef, useState } from "react";
import { listCards } from "@/lib/api/wgw/contacts";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useContactsLiveInbound } from "@/lib/offline/contacts/use-contacts-live-inbound";
import { readContactsBootstrapFromCache } from "@/lib/offline/contacts/contacts-offline-store";
import type { ContactCard } from "@/lib/models/contacts-types";

export type CalendarContactInviteesState = {
  cards: ContactCard[];
  refreshCards: () => void;
};

/**
 * Invitee suggestions come from the Contacts app's offline cache, which its
 * paced first download and live sync keep current. Calendar never downloads
 * the whole address book on open: on a cold start that doubled the Contacts
 * download as an unpaced burst (shared hosting traffic budget). Without a
 * cache the list starts empty; teammates and a typed email still work.
 */
export async function loadCalendarContactCards(username: string): Promise<ContactCard[]> {
  const account = username.trim();
  if (!account) return [];
  const cached = await readContactsBootstrapFromCache(account);
  return cached?.data.cards ?? [];
}

/**
 * Typing in the invitee search re-reads the cache, which the Contacts live
 * inbound sync keeps current (mounted below, one syncing tab per browser).
 * Only when this browser has no contacts cache at all does it ask the server.
 */
export async function refreshCalendarContactCards(username: string): Promise<ContactCard[] | null> {
  const account = username.trim();
  if (!account) return null;
  const cached = await readContactsBootstrapFromCache(account);
  if (cached) return cached.data.cards;
  try {
    return await listCards();
  } catch {
    // Keep the last good cache/list; callers treat null as "do not replace".
    return null;
  }
}

export function useCalendarContactInvitees(username?: string): CalendarContactInviteesState {
  const [cards, setCards] = useState<ContactCard[]>([]);
  const [hasCache, setHasCache] = useState(false);
  const loadGen = useRef(0);
  const { online } = useConnectivity();

  const rereadCache = useCallback(async () => {
    const account = username?.trim() ?? "";
    if (!account) return;
    const cached = await readContactsBootstrapFromCache(account);
    if (cached) {
      setHasCache(true);
      setCards(cached.data.cards);
    }
  }, [username]);

  // Keeps the cache current without a full download: a push or a /changes
  // round, run by one tab per browser. Needs a cache (and its sync token) first.
  useContactsLiveInbound({
    username: username?.trim() || null,
    enabled: hasCache && online && wgwLiveApiEnabled(),
    patchFromCache: rereadCache,
  });

  useEffect(() => {
    const account = username?.trim() ?? "";
    if (!account) {
      setCards([]);
      return;
    }

    const gen = ++loadGen.current;
    void readContactsBootstrapFromCache(account).then((cached) => {
      if (loadGen.current !== gen) return;
      setHasCache(Boolean(cached));
      setCards(cached?.data.cards ?? []);
    });
  }, [username]);

  const refreshCards = useCallback(() => {
    const account = username?.trim() ?? "";
    if (!account) return;

    const gen = ++loadGen.current;
    void readContactsBootstrapFromCache(account).then((cached) => {
      if (loadGen.current !== gen) return;
      // Contacts (maybe in another tab) wrote the cache since: use it and start the live sync.
      if (cached) {
        setHasCache(true);
        setCards(cached.data.cards);
        return;
      }
      void refreshCalendarContactCards(account).then((next) => {
        if (next == null || loadGen.current !== gen) return;
        setCards(next);
      });
    });
  }, [username]);

  return { cards, refreshCards };
}
