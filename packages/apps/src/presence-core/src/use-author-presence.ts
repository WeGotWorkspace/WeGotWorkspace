import { useMemo, useSyncExternalStore } from "react";
import type { ChatAuthorPresenceMap } from "@/lib/models/chat-types";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";
import type { PresenceCoworker, PresenceSnapshot } from "@/presence-core/src/presence-types";

const noopSubscribe = () => () => {};
const noSnapshot = (): PresenceSnapshot | null => null;

/** Roster usernames → online/away (anyone absent is treated offline). */
export function authorPresenceFromRoster(
  roster: readonly PresenceCoworker[],
): ChatAuthorPresenceMap {
  const map: Record<string, NonNullable<ChatAuthorPresenceMap[string]>> = {};
  for (const coworker of roster) {
    if (!coworker.username) continue;
    map[coworker.username] = coworker.status;
  }
  return map;
}

/**
 * Live author presence from the suite presence roster (username → online/away),
 * for the status dot on avatars in Chat, Meet and comment threads. Absent
 * without a store (Storybook/mock trees) so fixture maps stay in control.
 */
export function useAuthorPresence(): ChatAuthorPresenceMap | undefined {
  const store = usePresenceStoreContext();
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store ? () => store.getSnapshot() : noSnapshot,
  );
  return useMemo(() => {
    if (!snapshot) return undefined;
    const map = authorPresenceFromRoster(snapshot.roster);
    // The roster lists coworkers only; the signed-in user is online once joined.
    if (snapshot.selfUsername && snapshot.status === "online") {
      return { ...map, [snapshot.selfUsername]: "online" };
    }
    return map;
  }, [snapshot]);
}
