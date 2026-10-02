import { useSyncExternalStore } from "react";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { useMeetKnockChime } from "@/meet-core/src/use-meet-knock-chime";

/**
 * One knock chime for the whole suite. It stays mounted when Meet unmounts, so
 * a knock still plays from the mini-player and does not replay on the way back.
 */
export function MeetKnockChime() {
  const store = useMeetCallStoreContext();
  if (!store) return null;
  return <MeetKnockChimeBound store={store} />;
}

function MeetKnockChimeBound({ store }: { store: MeetCallStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useMeetKnockChime(
    snapshot.knockers.map((knocker) => knocker.id),
    snapshot.status === "in-call" && snapshot.canModerateKnocks,
  );
  return null;
}
