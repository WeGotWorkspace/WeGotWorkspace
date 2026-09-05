import { useCallback, useMemo, useState } from "react";
import { createWgwMeetOperations } from "@/lib/api/wgw/meet";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetChatApiSource } from "@/meet-core/src/meet-chat-api-source";
import type { MeetAPIOperations, MeetChatOperations, MeetUIData } from "@/meet-core/src/meet-types";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { useMeetChatAPI } from "@/meet-core/src/use-meet-chat-api";
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

  const { operations, callStageRoom, liveCallChannelId, joinedRoomCode } = useMeetChatCall({
    session,
    data,
    identityReady: !listLoading,
    channels,
    meetOperations,
    chatOperations,
  });

  const callActiveByChannel = useMeetChannelCallActivity({
    operations: meetOperations,
    channels,
    selectedChannelId,
    joinedRoomCode,
  });

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
      liveCallChannelId={liveCallChannelId}
      onSelectedChannelChange={setSelectedChannelId}
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
