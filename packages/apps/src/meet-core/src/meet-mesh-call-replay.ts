import { useEffect, useRef } from "react";
import { presenceCallActiveEnvelope } from "@/presence-core/src/presence-envelope";
import type { PresenceStore } from "@/presence-core/src/presence-store";

/** Stable key of channel members currently on the presence roster. */
export function meetMeshOnlineTargetKey(
  targets: readonly string[],
  rosterUsernames: readonly string[],
): string {
  const online = new Set(rosterUsernames);
  return targets
    .filter((name) => online.has(name))
    .sort()
    .join("\n");
}

/**
 * Re-send `call-active` when a channel member's presence DC comes up.
 * The startCall fan-out is one-shot; late joiners otherwise only see room-status
 * (no audioOnly) and Join with camera on.
 */
export function useMeetMeshCallReplay({
  store,
  liveCallChannelId,
  audioOnly,
  targetsFor,
}: {
  store: PresenceStore | null;
  liveCallChannelId?: string | null;
  audioOnly: boolean;
  targetsFor: (channelId: string) => string[];
}): void {
  const targetsForRef = useRef(targetsFor);
  targetsForRef.current = targetsFor;

  useEffect(() => {
    if (!store || !liveCallChannelId) return;
    const envelope = presenceCallActiveEnvelope(liveCallChannelId, true, audioOnly);
    let lastKey = "";
    const flush = () => {
      const targets = targetsForRef.current(liveCallChannelId);
      const key = meetMeshOnlineTargetKey(
        targets,
        store.getSnapshot().roster.map((row) => row.username),
      );
      if (key === lastKey) return;
      lastKey = key;
      store.sendToUsernames(targets, envelope);
    };
    flush();
    return store.subscribe(flush);
  }, [audioOnly, liveCallChannelId, store]);
}
