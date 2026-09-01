import { useCallback, useState } from "react";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetChatOperations } from "@/meet-core/src/meet-types";

export type UseMeetCallLayoutArgs = {
  initialLayout?: MeetCallStageLayout;
  operations?: MeetChatOperations;
  channelId: string | null;
};

export function useMeetCallLayout({
  initialLayout = "collapsed",
  operations,
  channelId,
}: UseMeetCallLayoutArgs) {
  const [callLayout, setCallLayout] = useState<MeetCallStageLayout>(initialLayout);
  const callActive = callLayout !== "collapsed";

  const startCall = useCallback(() => {
    setCallLayout("side-by-side");
    if (channelId) void operations?.startCall?.(channelId);
  }, [channelId, operations]);

  const leaveCall = useCallback(() => {
    setCallLayout("collapsed");
    if (channelId) void operations?.leaveCall?.(channelId);
  }, [channelId, operations]);

  const toggleCall = useCallback(() => {
    if (callActive) leaveCall();
    else startCall();
  }, [callActive, leaveCall, startCall]);

  const onLayoutChange = useCallback(
    (layout: MeetCallStageLayout) => {
      setCallLayout(layout);
      if (layout === "collapsed" && channelId) {
        void operations?.leaveCall?.(channelId);
      }
    },
    [channelId, operations],
  );

  return { callLayout, callActive, startCall, leaveCall, toggleCall, onLayoutChange };
}
