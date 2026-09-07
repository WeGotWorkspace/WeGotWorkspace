import { useState } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import type { MeetAppProps } from "@/meet-core/src/meet-app-props";
import { MeetChatPane } from "@/meet-core/src/meet-chat-pane";
import { MeetGuestChannel, meetGuestChannelPhase } from "@/meet-core/src/meet-guest-channel";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetCallWorkspaceProps } from "@/meet-core/src/meet-call-workspace-props";
import { useMeetAPI } from "@/meet-core/src/use-meet-api";
import { useMeetRouteSync } from "@/meet-core/src/use-meet-route-sync";
import { useMeetWorkspaceShell } from "@/meet-core/src/use-meet-workspace-shell";

/**
 * Live guest/invite surface: Storybook `MeetGuestChannel` (cream/dusk lobby + call stage),
 * not the retired `MeetCallWorkspace` shell.
 */
export function MeetApp({ source }: MeetAppProps = {}) {
  const { phase, error, retry, successVersion, listLoading, data, session, operations } =
    useMeetAPI(source);
  const { invitedRoom, isJoinRoute, buildCallLink, onRoomChange } = useMeetRouteSync();

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
  buildCallLink,
  onRoomChange,
}: Pick<
  MeetCallWorkspaceProps,
  | "data"
  | "session"
  | "operations"
  | "listLoading"
  | "invitedRoom"
  | "isJoinRoute"
  | "buildCallLink"
  | "onRoomChange"
>) {
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
  const [callLayout, setCallLayout] = useState<MeetCallStageLayout>("side-by-side");
  const channelName = meetLabels.productName;
  const phase = meetGuestChannelPhase({
    inCall: shell.inCall,
    showInviteCheckingScreen: shell.lobby.showInviteCheckingScreen,
    showWaitingForHostScreen: shell.lobby.showWaitingForHostScreen,
    showMissingInviteScreen: shell.lobby.showMissingInviteScreen,
    showInviteErrorScreen: shell.lobby.showInviteErrorScreen,
    endedMessage: shell.lobby.endedMessage,
    waitingForAdmission: shell.lobby.waitingForAdmission,
  });
  const chat = (
    <MeetChatPane
      messages={shell.controller.chatMessages}
      draft={shell.chat.draft}
      onDraftChange={shell.chat.onDraftChange}
      onSend={shell.chat.onSend}
      onClose={shell.chat.onClose}
    />
  );

  const { chatOpen: _chatOpen, onToggleChat: _onToggleChat, ...stageRoom } = shell.room;

  return (
    <MeetGuestChannel
      channelName={channelName}
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
      callLayout={callLayout}
      chat={chat}
      onLayoutChange={setCallLayout}
    />
  );
}
