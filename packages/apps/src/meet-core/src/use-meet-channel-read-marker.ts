import { useEffect, useRef } from "react";

export type UseMeetChannelReadMarkerArgs = {
  selectedChannelId: string | null;
  markChannelRead?: (channelId: string) => Promise<void>;
  /** Latest cached message id in the selected conversation (inbound while focused). */
  selectedLatestMessageId?: string | null;
  /** Unread on the selected conversation; sentinel mark when history is empty. */
  selectedUnreadCount?: number;
  /**
   * False while the visible list is scrolled up. Default true so existing
   * callers keep marking on select / inbound.
   */
  caughtUp?: boolean;
};

function markIfVisible(
  channelId: string | null,
  markChannelRead: ((channelId: string) => Promise<void>) | undefined,
  caughtUp: boolean,
): void {
  if (!caughtUp || !channelId || !markChannelRead) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  void markChannelRead(channelId).catch(() => undefined);
}

/**
 * Advance the server read marker when a conversation is active: on select,
 * when a new message lands while the tab is visible, and when the tab returns
 * from background with a channel already selected. Gated by `caughtUp` so a
 * scrolled-up transcript does not zero the sidebar unread.
 */
export function useMeetChannelReadMarker({
  selectedChannelId,
  markChannelRead,
  selectedLatestMessageId,
  selectedUnreadCount,
  caughtUp = true,
}: UseMeetChannelReadMarkerArgs): void {
  const markRef = useRef(markChannelRead);
  markRef.current = markChannelRead;
  const selectedRef = useRef(selectedChannelId);
  selectedRef.current = selectedChannelId;
  const caughtUpRef = useRef(caughtUp);
  caughtUpRef.current = caughtUp;
  const canMark = Boolean(markChannelRead);

  useEffect(() => {
    markIfVisible(selectedChannelId, markRef.current, caughtUp);
  }, [canMark, selectedChannelId, selectedLatestMessageId, selectedUnreadCount, caughtUp]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      markIfVisible(selectedRef.current, markRef.current, caughtUpRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
