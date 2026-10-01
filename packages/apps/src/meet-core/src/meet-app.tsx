import { useMemo } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { MeetAppProps } from "@/meet-core/src/meet-app-props";
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
import { meetGuestChatChannelId } from "@/meet-core/src/meet-channel-room";
import { meetChatLineToChannelMessage } from "@/meet-core/src/meet-chat-line";
import { MeetGuestChannel, meetGuestChannelPhase } from "@/meet-core/src/meet-guest-channel";
import { meetGuestInviteChannel } from "@/meet-core/src/meet-guest-invite-channel";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { useMeetAPI } from "@/meet-core/src/use-meet-api";
import { useMeetRouteSync } from "@/meet-core/src/use-meet-route-sync";
import {
  useMeetWorkspaceShell,
  type MeetWorkspaceShellInput,
} from "@/meet-core/src/use-meet-workspace-shell";

/**
 * Live guest/invite surface: cream/dusk `MeetGuestChannel` (lobby + call stage).
 */
export function MeetApp({ source }: MeetAppProps = {}) {
  const { phase, error, retry, successVersion, listLoading, data, session, operations } =
    useMeetAPI(source);
  const { invitedRoom, isJoinRoute, buildCallLink, onRoomChange, channelId, meetingId } =
    useMeetRouteSync();

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load live meet"
      successVersion={successVersion}
      render={(key) => (
        <MeetGuestChannelLive
          key={key}
          data={data}
          session={session}
          operations={operations}
          listLoading={listLoading}
          invitedRoom={invitedRoom}
          isJoinRoute={isJoinRoute}
          channelId={channelId}
          meetingId={meetingId}
          buildCallLink={buildCallLink}
          onRoomChange={onRoomChange}
        />
      )}
    />
  );
}

function MeetGuestChannelLive({
  data,
  session,
  operations,
  listLoading = false,
  invitedRoom = null,
  isJoinRoute = false,
  channelId = null,
  meetingId = null,
  buildCallLink,
  onRoomChange,
}: MeetWorkspaceShellInput & {
  channelId?: string | null;
  meetingId?: string | null;
}) {
  const shell = useMeetWorkspaceShell({
    data,
    session,
    operations,
    listLoading,
    invitedRoom,
    isJoinRoute,
    buildCallLink,
    onRoomChange,
  });
  const invite = meetGuestInviteChannel({
    channels: data.channels,
    invitedRoom,
    channelId,
    meetingId,
    fallbackName: meetLabels.productName,
  });
  const phase = meetGuestChannelPhase({
    inCall: shell.inCall,
    showInviteCheckingScreen: shell.lobby.showInviteCheckingScreen,
    showWaitingForHostScreen: shell.lobby.showWaitingForHostScreen,
    showMissingInviteScreen: shell.lobby.showMissingInviteScreen,
    showInviteErrorScreen: shell.lobby.showInviteErrorScreen,
    endedMessage: shell.lobby.endedMessage,
    waitingForAdmission: shell.lobby.waitingForAdmission,
  });
  const guestChatChannelId = meetGuestChatChannelId({
    channels: data.channels,
    invitedRoom,
    channelId,
    meetingId,
  });
  const chatMessages = useMemo(
    () =>
      shell.controller.chatMessages.map((line) =>
        meetChatLineToChannelMessage(line, guestChatChannelId),
      ),
    [guestChatChannelId, shell.controller.chatMessages],
  );
  const chat = (
    <MeetChatColumn
      messages={chatMessages}
      currentUserId={shell.controller.selfId ?? "guest"}
      principals={[]}
      placeholder={meetLabels.chatPlaceholder}
      onSend={(payload) => {
        void shell.controller.sendChat(payload.body);
      }}
      onReact={() => undefined}
      onReply={() => undefined}
      onDelete={() => undefined}
    />
  );

  const { chatOpen: _chatOpen, onToggleChat: _onToggleChat, ...stageRoom } = shell.room;

  return (
    <MeetGuestChannel
      channelName={invite.name}
      channelTopic={invite.topic}
      channelKind={invite.kind}
      phase={phase}
      lobby={{
        controller: shell.controller,
        displayName: shell.displayName,
        ...shell.lobby,
      }}
      stage={{
        controller: shell.controller,
        displayName: shell.displayName,
        ...stageRoom,
      }}
      callLayout="side-by-side"
      chat={chat}
    />
  );
}
