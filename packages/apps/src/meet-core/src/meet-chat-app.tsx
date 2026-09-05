import { useCallback, useEffect, useMemo, useState } from "react";
import { createWgwMeetOperations } from "@/lib/api/wgw/meet";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import { meetChannelTitle } from "@/meet-core/src/meet-channel-label";
import type { MeetChatApiSource } from "@/meet-core/src/meet-chat-api-source";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import type { MeetAPIOperations, MeetChatOperations, MeetUIData } from "@/meet-core/src/meet-types";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { useMeetChatAPI } from "@/meet-core/src/use-meet-chat-api";
import { useMeetChannelTyping } from "@/meet-core/src/use-meet-channel-typing";
import { useMeetChatCall } from "@/meet-core/src/use-meet-chat-call";
import { useMeetChannelCallActivity } from "@/meet-core/src/use-meet-channel-call-activity";

export type MeetChatAppProps = {
  /** Chat bootstrap/ops source (defaults to the hybrid Dexie + REST source). */
  source?: MeetChatApiSource;
  /** Meet signaling REST surface (defaults to the authenticated live client). */
  createMeetOperations?: () => MeetAPIOperations;
};

function MeetChatLiveWorkspace({
  data,
  session,
  chatOperations,
  meetOperations,
  listLoading,
  onLogout,
}: {
  data: MeetUIData;
  session: WorkspaceSession;
  chatOperations?: MeetChatOperations;
  meetOperations: MeetAPIOperations;
  listLoading: boolean;
  onLogout: () => void;
}) {
  const channels = useMemo(() => data.channels ?? [], [data.channels]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  // DM rail click: eagerly find-or-create the backing dm- collection (chunk G)
  // so history/unread sync starts before the first message. Best-effort — a
  // failure just defers provisioning to the first send/call.
  const handleSelectedChannelChange = useCallback(
    (channelId: string | null) => {
      setSelectedChannelId(channelId);
      const dmPrincipal = channelId ? meetDirectMessagePrincipalId(channelId) : null;
      if (dmPrincipal) void chatOperations?.openDm?.(dmPrincipal).catch(() => undefined);
    },
    [chatOperations],
  );

  const { operations, callStageRoom, liveCallChannelId, joinedRoomCode } = useMeetChatCall({
    session,
    data,
    identityReady: !listLoading,
    channels,
    meetOperations,
    chatOperations,
  });

  // Typing indicators ride the workspace presence mesh (chunk K); degrades to a
  // no-op when the mesh is absent (guest session, mesh not joined yet).
  const { typingByChannel, onComposerTyping } = useMeetChannelTyping();

  const callActiveByChannel = useMeetChannelCallActivity({
    operations: meetOperations,
    channels,
    selectedChannelId,
    joinedRoomCode,
  });

  // Mini-player title: the live call's channel/meeting title or DM peer name.
  const suiteCallStore = useMeetCallStoreContext();
  useEffect(() => {
    if (!suiteCallStore) return;
    if (!liveCallChannelId) {
      suiteCallStore.setCallLabel(null);
      return;
    }
    const dmPrincipal = meetDirectMessagePrincipalId(liveCallChannelId);
    if (dmPrincipal) {
      const person = data.directory?.find((principal) => principal.id === dmPrincipal);
      suiteCallStore.setCallLabel(person?.displayName?.trim() || dmPrincipal);
      return;
    }
    const channel = channels.find((row) => row.id === liveCallChannelId);
    suiteCallStore.setCallLabel(channel ? meetChannelTitle(channel) : null);
  }, [channels, data.directory, liveCallChannelId, suiteCallStore]);

  const dataWithCallActivity = useMemo<MeetUIData>(() => {
    if (Object.keys(callActiveByChannel).length === 0) return data;
    return {
      ...data,
      channels: channels.map((channel) =>
        callActiveByChannel[channel.id] && !channel.callActive
          ? { ...channel, callActive: true }
          : channel,
      ),
    };
  }, [callActiveByChannel, channels, data]);

  return (
    <MeetWorkspace
      data={dataWithCallActivity}
      session={session}
      operations={operations}
      onLogout={onLogout}
      callStageRoom={callStageRoom}
      // Returning to /meet mid-call (mini-player) lands on the call's channel.
      initialChannelId={liveCallChannelId ?? undefined}
      liveCallChannelId={liveCallChannelId}
      onSelectedChannelChange={handleSelectedChannelChange}
      typingByChannel={typingByChannel}
      onComposerTyping={onComposerTyping}
    />
  );
}

/**
 * Live `/meet` composition (chunk F): the Slack-like `MeetWorkspace` on the
 * hybrid chat client (chunk E) with a call stage driven by the real Meet
 * controller. `startCall`/`leaveCall` join the deterministic channel room
 * (`meet-channel-room.ts`); the guest flow stays on `MeetApp`/`/meet/join`.
 */
export function MeetChatApp({ source, createMeetOperations }: MeetChatAppProps = {}) {
  const { phase, error, retry, successVersion, listLoading, data, session, operations } =
    useMeetChatAPI(source);
  const meetOperations = useMemo(
    () => (createMeetOperations ?? createWgwMeetOperations)(),
    [createMeetOperations],
  );

  const handleLogout = useCallback(() => {
    window.location.assign("/logout");
  }, []);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load live meet"
      successVersion={successVersion}
      render={(key) => (
        <MeetChatLiveWorkspace
          key={key}
          data={data}
          session={session}
          chatOperations={operations}
          meetOperations={meetOperations}
          listLoading={listLoading}
          onLogout={handleLogout}
        />
      )}
    />
  );
}
