import { useEffect, useRef } from "react";
import type { MeetChannel, MeetChatOperations } from "@/meet-core/src/meet-types";

/**
 * Joins a meeting channel once while its scheduled window is live. Keyed on
 * channel and calendar event, so a second window on the same channel joins
 * again but one window never joins twice.
 */
export function useMeetScheduledAutoJoin({
  selected,
  selectedId,
  selectedMeetingEventId,
  scheduledWindowLive,
  callActive,
  liveCallChannelId,
  startCall,
  onJoin,
}: {
  selected: MeetChannel | null;
  selectedId: string | null;
  selectedMeetingEventId?: string | null;
  scheduledWindowLive: boolean;
  callActive: boolean;
  liveCallChannelId?: string | null;
  /** Absent in mock/story trees: without it there is nothing to join. */
  startCall?: MeetChatOperations["startCall"];
  onJoin: () => void;
}): void {
  const autoJoinedMeetingRef = useRef<string | null>(null);
  const autoJoinSelectedIdRef = useRef(selectedId);
  useEffect(() => {
    if (autoJoinSelectedIdRef.current === selectedId) return;
    autoJoinSelectedIdRef.current = selectedId;
    autoJoinedMeetingRef.current = null;
  }, [selectedId]);
  useEffect(() => {
    if (!selected || selected.kind !== "meeting" || !selectedId) return;
    if (!scheduledWindowLive || callActive) return;
    if (liveCallChannelId && liveCallChannelId !== selectedId) return;
    if (!startCall) return;
    const key = `${selectedId}:${selectedMeetingEventId ?? "window"}`;
    if (autoJoinedMeetingRef.current === key) return;
    autoJoinedMeetingRef.current = key;
    onJoin();
  }, [
    callActive,
    liveCallChannelId,
    onJoin,
    scheduledWindowLive,
    selected,
    selectedId,
    selectedMeetingEventId,
    startCall,
  ]);
}
