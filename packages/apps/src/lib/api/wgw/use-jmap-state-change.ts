import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { JmapPushHub } from "@/lib/jmap-client/push/jmap-push-hub";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import { defaultJmapPushHub } from "./jmap-push";

export type JmapPushHubLike = Pick<JmapPushHub, "connected" | "subscribe" | "subscribeStatus">;

/**
 * Run `onChange` when the server pushes new states for `types`
 * (docs/architecture/jmap-push.md, "Apps"):
 *
 * ```ts
 * useJmapStateChange(["Note", "Notebook"], (states) => notesAdapter.syncIfStale(states));
 * ```
 *
 * Pushes that arrive while `onChange` runs collapse into one next call with
 * the newest states. Resolve false when the sync failed, so the server sends
 * the type again. Without a hub (mock data) this does nothing, and the app's
 * own poll stays the only sync.
 */
export function useJmapStateChange(
  types: readonly string[],
  onChange: StateChangeListener,
  hub: JmapPushHubLike | null = defaultJmapPushHub(),
): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  const key = useMemo(() => [...new Set(types)].sort().join(","), [types]);

  useEffect(() => {
    if (!hub || key === "") return;
    return hub.subscribe(key.split(","), (states, accountId) => latest.current(states, accountId));
  }, [hub, key]);
}

/**
 * True while this browser's push stream is connected. Polls that push
 * replaces slow down while it is true and return to their normal interval
 * when push is down (rate-limited, unavailable, offline).
 */
export function useJmapPushConnected(hub: JmapPushHubLike | null = defaultJmapPushHub()): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => (hub ? hub.subscribeStatus(onStoreChange) : () => undefined),
    [hub],
  );
  const snapshot = useCallback(() => hub?.connected ?? false, [hub]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
