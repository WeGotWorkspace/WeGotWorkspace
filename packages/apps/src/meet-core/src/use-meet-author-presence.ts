import { useMemo, useSyncExternalStore } from "react";
import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import { authorPresenceFromRoster } from "@/meet-core/src/meet-author-presence";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";
import type { PresenceCoworker } from "@/presence-core/src/presence-types";

const EMPTY_ROSTER: PresenceCoworker[] = [];

const noopSubscribe = () => () => {};

const emptyRoster = (): PresenceCoworker[] => EMPTY_ROSTER;

/**
 * Live chat-author presence from the suite presence roster (username → online/away).
 * Absent without a store (Storybook/mock trees) so fixture maps stay in control.
 */
export function useMeetAuthorPresence(): ChatAuthorPresenceMap | undefined {
  const store = usePresenceStoreContext();
  const roster = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store ? () => store.getSnapshot().roster : emptyRoster,
  );

  return useMemo(() => (store ? authorPresenceFromRoster(roster) : undefined), [roster, store]);
}
