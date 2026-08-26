import { useCallback, useEffect, useRef, useState } from "react";
import { listCards } from "@/lib/api/wgw/contacts";
import { readContactsBootstrapFromCache } from "@/lib/offline/contacts-offline-store";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type CalendarContactInviteesState = {
  cards: ContactCard[];
  refreshCards: () => void;
};

export async function loadCalendarContactCards(username: string): Promise<ContactCard[]> {
  const account = username.trim();
  if (!account) return [];

  const cached = await readContactsBootstrapFromCache(account);
  if (cached) return cached.data.cards;

  try {
    return await listCards();
  } catch {
    // Offline / JMAP / expired session: empty list; teammates and typed email still work.
    return [];
  }
}

export async function refreshCalendarContactCards(): Promise<ContactCard[] | null> {
  try {
    return await listCards();
  } catch {
    // Keep the last good cache/list; callers treat null as "do not replace".
    return null;
  }
}

export function useCalendarContactInvitees(username?: string): CalendarContactInviteesState {
  const [cards, setCards] = useState<ContactCard[]>([]);
  const loadGen = useRef(0);

  useEffect(() => {
    const account = username?.trim() ?? "";
    if (!account) {
      setCards([]);
      return;
    }

    const gen = ++loadGen.current;
    void loadCalendarContactCards(account).then((next) => {
      if (loadGen.current === gen) setCards(next);
    });
  }, [username]);

  const refreshCards = useCallback(() => {
    const account = username?.trim() ?? "";
    if (!account) return;

    const gen = ++loadGen.current;
    void refreshCalendarContactCards().then((next) => {
      if (next == null || loadGen.current !== gen) return;
      setCards(next);
    });
  }, [username]);

  return { cards, refreshCards };
}
