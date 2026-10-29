import { useEffect, useRef } from "react";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { defaultInboxFanOut, type InboxPayload } from "@/notifications-core/src/inbox-fan-out";

const PUSH_TYPES = ["Notification"] as const;
const NO_TYPES: readonly string[] = [];

/**
 * Inbox on push (docs/architecture/jmap-push.md): when the server pushes a new
 * `Notification` state, the tab that holds the push stream fetches once and
 * shares the rows; the other tabs show what it shared. That tab is visible
 * whenever any tab is, so a paused background tab never delays the bell.
 * Returns whether push is connected, so the caller can slow its fallback poll.
 *
 * `refresh` resolves the fetched inbox, or `null` when the fetch failed, so the
 * push is not confirmed and the server sends it again.
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

  useEffect(() => {
    if (!signedIn) return;
    return defaultInboxFanOut().onShared((payload) => latest.current.apply(payload));
  }, [signedIn]);

  useJmapStateChange(signedIn ? PUSH_TYPES : NO_TYPES, async () => {
    // The tab that holds the stream fetches and shares the rows.
    if (!defaultJmapPushHub()?.leading) return true;
    const payload = await latest.current.refresh();
    if (!payload) return false;
    defaultInboxFanOut().share(payload);
    return true;
  });

  return useJmapPushConnected();
}
