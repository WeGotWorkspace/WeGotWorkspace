import { useEffect, useRef } from "react";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { defaultInboxFanOut } from "@/notifications-core/src/inbox-fan-out";
import type { NotificationInboxList } from "@/notifications-core/src/notifications-types";

const PUSH_TYPES = ["Notification"] as const;
const NO_TYPES: readonly string[] = [];

/**
 * How long a tab that does not hold the push stream waits for the rows the
 * stream tab fetched. After that it does not confirm, so the server sends the
 * change again (the stream tab may have closed mid-fetch).
 */
export const INBOX_SHARE_WAIT_MS = 10_000;

/**
 * Inbox on push (docs/architecture/notifications.md, "Active news on the
 * client"): when the server pushes a new `Notification` state, the tab that
 * holds the push stream fetches once and shares the rows with that state; the
 * other tabs wait for them. That tab is visible whenever any tab is, so a
 * paused background tab never delays the bell.
 *
 * A tab confirms the push only once it has the rows. A failed fetch (or no
 * share in time) leaves it unconfirmed, so the server sends it again; a tab
 * that took over the stream while it waited fetches the rows itself.
 * Returns whether push is connected, so the caller can slow its fallback poll.
 *
 * `fetchForPush` resolves the newest inbox this tab has after its fetch, or
 * `null` when the fetch failed; a refresh started meanwhile must not cancel it.
 */
export function useNotificationsInboxPush(options: {
  signedIn: boolean;
  fetchForPush: () => Promise<NotificationInboxList | null>;
  apply: (payload: NotificationInboxList, state: string) => void;
}): boolean {
  const { signedIn } = options;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!signedIn) return;
    return defaultInboxFanOut().onShared((payload, state) => latest.current.apply(payload, state));
  }, [signedIn]);

  useJmapStateChange(signedIn ? PUSH_TYPES : NO_TYPES, async (states) => {
    const state = states.Notification;
    if (!state) return true;
    const fanOut = defaultInboxFanOut();
    const fetchAndShare = async () => {
      const payload = await latest.current.fetchForPush();
      if (!payload) {
        fanOut.shareFailed(state);
        return false;
      }
      fanOut.share(payload, state);
      return true;
    };
    if (defaultJmapPushHub()?.leading) return fetchAndShare();
    // The rows arrive through `onShared` above; confirm once they are here.
    if ((await fanOut.waitFor(state, INBOX_SHARE_WAIT_MS)) !== null) return true;
    // The stream may have moved to this tab while it waited.
    return defaultJmapPushHub()?.leading ? fetchAndShare() : false;
  });

  return useJmapPushConnected();
}
