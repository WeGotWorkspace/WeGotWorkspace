import { useCallback, useEffect, useRef } from "react";
import type { JmapInboundAdapter } from "@/lib/jmap-client/adapter/JmapInboundAdapter";
import {
  inboundSyncShare,
  isInboundSyncMessage,
  type InboundSyncMessage,
  type InboundSyncShare,
} from "@/lib/jmap-client/adapter/inbound-sync-share";
import { browserWebLocks } from "@/lib/jmap-client/push/web-locks-leader";
import { crossTabTopic, type CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { documentVisibility, randomTabId } from "./jmap-push";

/** The offline apps whose inbound sync runs in one tab per browser. */
export type SharedInboundApp = "notes" | "contacts" | "calendar" | "meet-chat" | "tasks";

let topic: CrossTabTopic<InboundSyncMessage> | undefined;

/**
 * This tab's seat among the tabs that sync `app` for `username`, or null in a
 * browser without Web Locks or BroadcastChannel: every tab then syncs for
 * itself, as before #2252.
 */
export function browserInboundSyncShare(
  app: SharedInboundApp,
  username: string,
): InboundSyncShare | null {
  const locks = browserWebLocks();
  if (!locks || typeof BroadcastChannel !== "function") return null;
  topic ??= crossTabTopic<InboundSyncMessage>("wgw-inbound-sync", isInboundSyncMessage);
  return inboundSyncShare({
    name: `wgw-inbound-sync/${app}/${username}`,
    tabId: randomTabId(),
    locks,
    topic,
    visibility: documentVisibility(),
  });
}

/**
 * Run `adapter`'s poll and push rounds in one tab per browser (#2252). In the
 * other tabs `onSharedRound` runs after each round of the syncing tab: re-read
 * the shared cache there. `adapter` is null until its first states loaded.
 */
export function useSharedInboundSync(
  adapter: JmapInboundAdapter | null,
  app: SharedInboundApp,
  username: string | null | undefined,
  onSharedRound: () => void,
): void {
  const latest = useRef(onSharedRound);
  useEffect(() => {
    latest.current = onSharedRound;
  }, [onSharedRound]);

  useEffect(() => {
    if (!adapter || !username) return;
    const share = browserInboundSyncShare(app, username);
    if (!share) return;
    return adapter.shareAcrossTabs(share, () => latest.current());
  }, [adapter, app, username]);
}

/**
 * This tab's seat for an app that syncs without a `JmapInboundAdapter` (Tasks).
 * The returned function says whether this tab pulls for the browser: true in
 * the one syncing tab, and in every tab without Web Locks, BroadcastChannel or
 * an account. `onTakeOver` runs when this tab starts syncing after another
 * tab: pull once there, to cover what that tab left behind.
 */
export function useInboundSyncSeat(
  app: SharedInboundApp,
  username: string | null | undefined,
  onTakeOver: () => void,
): () => boolean {
  const latest = useRef(onTakeOver);
  useEffect(() => {
    latest.current = onTakeOver;
  }, [onTakeOver]);
  const owns = useRef(true);

  useEffect(() => {
    if (!username) return;
    const share = browserInboundSyncShare(app, username);
    if (!share) return;
    owns.current = false;
    const stop = share.start({
      onOwn: (tookOver) => {
        owns.current = true;
        if (tookOver) latest.current();
      },
      onLose: () => {
        owns.current = false;
      },
      onRound: () => undefined,
    });
    return () => {
      stop();
      owns.current = true;
    };
  }, [app, username]);

  return useCallback(() => owns.current, []);
}
