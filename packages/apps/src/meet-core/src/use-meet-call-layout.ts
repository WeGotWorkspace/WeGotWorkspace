import { useCallback, useEffect, useRef, useState } from "react";
import { meetCallIsActive, type MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import { meetResumeCallLayout } from "@/meet-core/src/meet-call-resume";
import type { MeetChatOperations } from "@/meet-core/src/meet-types";

export type UseMeetCallLayoutArgs = {
  initialLayout?: MeetCallStageLayout;
  operations?: MeetChatOperations;
  channelId: string | null;
  /**
   * Channel owning the real RTC session (live app; `undefined` in mock/story
   * trees, which keeps layout state purely local). When provided, layout state
   * follows session *transitions*: a session that ends (remote end, join
   * failure) collapses its channel's chrome, and an already-running session
   * (e.g. restored from the suite call store after a route remount) restores
   * the last compact/expanded chrome instead of forcing the split stage.
   */
  liveCallChannelId?: string | null;
  /**
   * Compact vs expanded chrome to restore when an already-running session is
   * remounted. Defaults to the compact bar (join chrome), not the split stage.
   */
  resumeLayout?: MeetCallStageLayout;
};

/**
 * Layout that belongs on the open conversation at mount. A restored live
 * session's chrome stays on that session's channel — seeding it onto a
 * different open conversation paints joined controls there (#836).
 */
export function meetInitialCallLayoutForChannel(
  channelId: string | null,
  initialLayout: MeetCallStageLayout,
  liveCallChannelId?: string | null,
): MeetCallStageLayout {
  if (liveCallChannelId && channelId !== liveCallChannelId) return "collapsed";
  return initialLayout;
}

function seedLayouts(
  channelId: string | null,
  initialLayout: MeetCallStageLayout,
  liveCallChannelId?: string | null,
): Record<string, MeetCallStageLayout> {
  if (initialLayout === "collapsed") return {};
  const openLayout = meetInitialCallLayoutForChannel(channelId, initialLayout, liveCallChannelId);
  if (openLayout === "collapsed") {
    return liveCallChannelId ? { [liveCallChannelId]: initialLayout } : {};
  }
  if (!channelId) return {};
  return { [channelId]: openLayout };
}

/**
 * Local join / expand state is keyed by channel id. Switching channels does not
 * hang up — the other channel simply does not render that session’s chrome.
 */
export function useMeetCallLayout({
  initialLayout = "collapsed",
  operations,
  channelId,
  liveCallChannelId,
  resumeLayout,
}: UseMeetCallLayoutArgs) {
  const [layouts, setLayouts] = useState<Record<string, MeetCallStageLayout>>(() =>
    seedLayouts(channelId, initialLayout, liveCallChannelId),
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

  // Live session sync — transition-based so it never fights an in-flight local
  // action (start writes its layout before the session reaches "preparing";
  // a local leave collapses before the session drops).
  const previousLiveChannelRef = useRef<string | null>(null);
  useEffect(() => {
    if (liveCallChannelId === undefined) return;
    const previous = previousLiveChannelRef.current;
    if (previous === liveCallChannelId) return;
    previousLiveChannelRef.current = liveCallChannelId;
    if (previous) writeLayout(previous, "collapsed");
    if (!liveCallChannelId) return;
    const restored = meetResumeCallLayout(resumeLayout);
    setLayouts((current) =>
      meetCallIsActive(current[liveCallChannelId] ?? "collapsed")
        ? current
        : { ...current, [liveCallChannelId]: restored },
    );
  }, [liveCallChannelId, resumeLayout, writeLayout]);

  const startCall = useCallback(
    (options?: { video?: boolean }) => {
      writeLayout(channelId, "compact");
      if (!channelId) return;
      const started =
        options === undefined
          ? operations?.startCall?.(channelId)
          : operations?.startCall?.(channelId, options);
      // A rejected start (join failed, calls unavailable) takes the chrome back
      // down instead of leaving an idle call bar behind. Mock ops never reject.
      void started?.catch(() => writeLayout(channelId, "collapsed"));
    },
    [channelId, operations, writeLayout],
  );

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
