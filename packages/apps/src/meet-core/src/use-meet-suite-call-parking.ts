import { useEffect } from "react";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import {
  meetCallStatusEngaged,
  meetCallUiParkedOnWorkspaceUnmount,
} from "@/meet-core/src/meet-call-resume";

/**
 * Mini-player handshake with the suite call store: while the live call's channel
 * is not on screen the call is "parked" here, so the suite mini-player may show
 * inside `/meet`. A null store (mock/Storybook trees) makes this a no-op.
 */
export function useMeetSuiteCallParking({
  suiteCallStore,
  liveCallChannelId,
  selectedId,
  showCallChrome,
  callLayout,
  callLayoutIsActive,
  onFocusCallChannel,
}: {
  suiteCallStore: ReturnType<typeof useMeetCallStoreContext>;
  liveCallChannelId?: string | null;
  selectedId: string | null;
  showCallChrome: boolean;
  callLayout: MeetCallStageLayout;
  callLayoutIsActive: boolean;
  onFocusCallChannel: (channelId: string) => void;
}): void {
  const liveCallParked = Boolean(
    liveCallChannelId && !(selectedId === liveCallChannelId && showCallChrome),
  );
  useEffect(() => {
    suiteCallStore?.setCallUiParked(liveCallParked);
  }, [liveCallParked, suiteCallStore]);
  useEffect(() => {
    if (!suiteCallStore || !liveCallChannelId) return;
    if (selectedId !== liveCallChannelId) return;
    if (!callLayoutIsActive) return;
    suiteCallStore.setCallUiLayout(callLayout);
  }, [callLayout, callLayoutIsActive, liveCallChannelId, selectedId, suiteCallStore]);
  useEffect(() => {
    if (!suiteCallStore || !liveCallChannelId) return;
    suiteCallStore.focusCallChannelRef.current = () => onFocusCallChannel(liveCallChannelId);
    return () => {
      suiteCallStore.focusCallChannelRef.current = null;
    };
  }, [liveCallChannelId, onFocusCallChannel, suiteCallStore]);
  useEffect(
    () => () => {
      if (!suiteCallStore) return;
      const engaged = meetCallStatusEngaged(suiteCallStore.getSnapshot().status);
      suiteCallStore.setCallUiParked(meetCallUiParkedOnWorkspaceUnmount(engaged));
    },
    [suiteCallStore],
  );
}
