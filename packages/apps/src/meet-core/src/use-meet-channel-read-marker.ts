import { useEffect, useRef } from "react";

export type UseMeetChannelReadMarkerArgs = {
  selectedChannelId: string | null;
  markChannelRead?: (channelId: string) => Promise<void>;
  /** Latest cached message id in the selected conversation (inbound while focused). */
  selectedLatestMessageId?: string | null;
  /** Unread on the selected conversation; sentinel mark when history is empty. */
  selectedUnreadCount?: number;
};

function markIfVisible(
  channelId: string | null,
  markChannelRead: ((channelId: string) => Promise<void>) | undefined,
): void {
  if (!channelId || !markChannelRead) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  void markChannelRead(channelId).catch(() => undefined);
}

/**
 * Advance the server read marker when a conversation is active: on select,
 * when a new message lands while the tab is visible, and when the tab returns
 * from background with a channel already selected.
 */
export function useMeetChannelReadMarker({
  selectedChannelId,
  markChannelRead,
  selectedLatestMessageId,
  selectedUnreadCount,
}: UseMeetChannelReadMarkerArgs): void {
  const markRef = useRef(markChannelRead);
  markRef.current = markChannelRead;
  const selectedRef = useRef(selectedChannelId);
  selectedRef.current = selectedChannelId;
  const canMark = Boolean(markChannelRead);

  useEffect(() => {
    markIfVisible(selectedChannelId, markRef.current);
  }, [canMark, selectedChannelId, selectedLatestMessageId, selectedUnreadCount]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      markIfVisible(selectedRef.current, markRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
