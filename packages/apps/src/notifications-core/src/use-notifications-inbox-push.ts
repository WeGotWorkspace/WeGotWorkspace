import { useEffect, useRef } from "react";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { defaultInboxFanOut, type InboxPayload } from "@/notifications-core/src/inbox-fan-out";

const PUSH_TYPES = ["Notification"] as const;
const NO_TYPES: readonly string[] = [];
/** How long a tab without the stream waits for the leading tab's rows. */
const PUSH_SHARE_WAIT_MS = 10_000;

/**
 * Inbox on push (docs/architecture/jmap-push.md): when the server pushes a new
 * `Notification` state, the tab that holds the push stream fetches once and
 * shares the rows; the other tabs show what it shared. That tab is visible
 * whenever any tab is, so a paused background tab never delays the bell.
 * Returns whether push is connected, so the caller can slow its fallback poll.
 *
 * `refresh` resolves the fetched inbox, or `null` when the fetch failed or a
 * newer refresh replaced it. The push is then not confirmed, the leader tells
 * the other tabs, and the server sends it again. A tab without the stream
 * confirms after it applied the shared rows.
 */
export function useNotificationsInboxPush(options: {
  signedIn: boolean;
  refresh: () => Promise<InboxPayload | null>;
  apply: (payload: InboxPayload) => void;
}): boolean {
  const { signedIn } = options;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // Settlers of this tab's push events that wait for the leading tab's rows.
  const waiting = useRef(new Set<(confirmed: boolean) => void>());

  useEffect(() => {
    if (!signedIn) return;
    const fanOut = defaultInboxFanOut();
    const stopShared = fanOut.onShared((payload) => {
      latest.current.apply(payload);
      for (const settle of [...waiting.current]) settle(true);
    });
    const stopFailed = fanOut.onFailed(() => {
      for (const settle of [...waiting.current]) settle(false);
    });
    return () => {
      stopShared();
      stopFailed();
    };
  }, [signedIn]);

  const fetchAndShare = async (): Promise<boolean> => {
    const payload = await latest.current.refresh();
    if (!payload) {
      defaultInboxFanOut().shareFailure();
      return false;
    }
    defaultInboxFanOut().share(payload);
    return true;
  };

  useJmapStateChange(signedIn ? PUSH_TYPES : NO_TYPES, async () => {
    // The tab that holds the stream fetches and shares the rows.
    if (defaultJmapPushHub()?.leading) return fetchAndShare();
    // Any other tab confirms only once it has the rows, so a leader that goes
    // away mid-fetch leaves the push unconfirmed and the server sends it again.
    const shared = await new Promise<boolean>((resolve) => {
      const settle = (confirmed: boolean) => {
        window.clearTimeout(timer);
        waiting.current.delete(settle);
        resolve(confirmed);
      };
      const timer = window.setTimeout(() => settle(false), PUSH_SHARE_WAIT_MS);
      waiting.current.add(settle);
    });
    if (shared) return true;
    // The stream may have moved to this tab while it waited.
    return defaultJmapPushHub()?.leading ? fetchAndShare() : false;
  });

  return useJmapPushConnected();
}
