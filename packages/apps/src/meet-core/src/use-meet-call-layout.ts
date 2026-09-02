import { useCallback, useState } from "react";
import { meetCallIsActive, type MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetChatOperations } from "@/meet-core/src/meet-types";

export type UseMeetCallLayoutArgs = {
  initialLayout?: MeetCallStageLayout;
  operations?: MeetChatOperations;
  channelId: string | null;
};

function seedLayouts(
  channelId: string | null,
  initialLayout: MeetCallStageLayout,
): Record<string, MeetCallStageLayout> {
  if (!channelId || initialLayout === "collapsed") return {};
  return { [channelId]: initialLayout };
}

/**
 * Local join / expand state is keyed by channel id. Switching channels does not
 * hang up — the other channel simply does not render that session’s chrome.
 */
export function useMeetCallLayout({
  initialLayout = "collapsed",
  operations,
  channelId,
}: UseMeetCallLayoutArgs) {
  const [layouts, setLayouts] = useState<Record<string, MeetCallStageLayout>>(() =>
    seedLayouts(channelId, initialLayout),
  );
  const callLayout = (channelId && layouts[channelId]) || "collapsed";
  const callActive = meetCallIsActive(callLayout);
  const isChannelJoined = useCallback(
    (id: string | null | undefined) => Boolean(id && meetCallIsActive(layouts[id] ?? "collapsed")),
    [layouts],
  );

  const writeLayout = useCallback((id: string | null, layout: MeetCallStageLayout) => {
    if (!id) return;
    setLayouts((current) => {
      if (layout === "collapsed") {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      if (current[id] === layout) return current;
      return { ...current, [id]: layout };
    });
  }, []);

  const startCall = useCallback(() => {
    writeLayout(channelId, "compact");
    if (channelId) void operations?.startCall?.(channelId);
  }, [channelId, operations, writeLayout]);

  const leaveCall = useCallback(() => {
    writeLayout(channelId, "collapsed");
    if (channelId) void operations?.leaveCall?.(channelId);
  }, [channelId, operations, writeLayout]);

  const toggleCall = useCallback(() => {
    if (callActive) leaveCall();
    else startCall();
  }, [callActive, leaveCall, startCall]);

  const onLayoutChange = useCallback(
    (layout: MeetCallStageLayout) => {
      writeLayout(channelId, layout);
      if (layout === "collapsed" && channelId) {
        void operations?.leaveCall?.(channelId);
      }
    },
    [channelId, operations, writeLayout],
  );

  return {
    callLayout,
    callActive,
    isChannelJoined,
    startCall,
    leaveCall,
    toggleCall,
    onLayoutChange,
  };
}
