import { useEffect, useRef, useState } from "react";
import { MeetChatPane } from "@/meet-core/src/meet-chat-pane";
import { MeetSelfPreviewPiP } from "@/meet-core/src/meet-self-preview-pip";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  MeetLobbyPaneHarness,
  MeetRoomPaneHarness,
} from "@/meet-core/stories/meet-pane-stories.harness";
import {
  STORY_MEET_CHAT_MESSAGES,
  STORY_MEET_KNOCKERS,
  STORY_MEET_PEERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { STORY_NOOP } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

/** Thin render wrappers: meta `component` stays the real pane; controller comes from harness. */

export type MeetLobbyPaneStoryArgs = {
  displayName: string;
  inJoinFlow: boolean;
  hasSignedInIdentity: boolean;
  invitedRoom: string | null;
  waitingForAdmission: boolean;
  knockDots: number;
  endedMessage: string;
  showMissingInviteScreen: boolean;
  showInviteCheckingScreen: boolean;
  showWaitingForHostScreen: boolean;
  showInviteErrorScreen: boolean;
  canStartReservedRoom: boolean;
  videoOn: boolean;
  error: string;
};

export function MeetLobbyPaneStory(args: MeetLobbyPaneStoryArgs) {
  return (
    <MeetLobbyPaneHarness
      displayName={args.displayName}
      inJoinFlow={args.inJoinFlow}
      hasSignedInIdentity={args.hasSignedInIdentity}
      invitedRoom={args.invitedRoom || null}
      waitingForAdmission={args.waitingForAdmission}
      knockDots={args.knockDots}
      endedMessage={args.endedMessage || null}
      showMissingInviteScreen={args.showMissingInviteScreen}
      showInviteCheckingScreen={args.showInviteCheckingScreen}
      showWaitingForHostScreen={args.showWaitingForHostScreen}
      showInviteErrorScreen={args.showInviteErrorScreen}
      canStartReservedRoom={args.canStartReservedRoom}
      controllerOverrides={{
        displayName: args.displayName,
        videoOn: args.videoOn,
        error: args.error || null,
        waitingForAdmission: args.waitingForAdmission,
      }}
    />
  );
}

export type MeetRoomPaneStoryArgs = {
  displayName: string;
  hasSignedInIdentity: boolean;
  participantCount: number;
  chatOpen: boolean;
  screenOn: boolean;
  peerCount: number;
  showKnockers: boolean;
  callExitMode: "end" | "leave";
};

export function MeetRoomPaneStory(args: MeetRoomPaneStoryArgs) {
  const peers = STORY_MEET_PEERS.slice(
    0,
    Math.max(0, Math.min(args.peerCount, STORY_MEET_PEERS.length)),
  );
  const callExitLabel = args.callExitMode === "leave" ? meetLabels.leaveCall : meetLabels.endCall;
  const callExitTitle =
    args.callExitMode === "leave" ? meetLabels.leaveCallTitle : meetLabels.endCallTitle;
  const callExitDescription =
    args.callExitMode === "leave" ? meetLabels.leaveCallDescription : meetLabels.endCallDescription;

  return (
    <MeetRoomPaneHarness
      displayName={args.displayName}
      hasSignedInIdentity={args.hasSignedInIdentity}
      participantCount={args.participantCount}
      chatOpen={args.chatOpen}
      callExitLabel={callExitLabel}
      callExitTitle={callExitTitle}
      callExitDescription={callExitDescription}
      controllerOverrides={{
        peers,
        knockers: args.showKnockers ? STORY_MEET_KNOCKERS : [],
        screenOn: args.screenOn,
        screenPreviewStream: null,
        displayName: args.displayName,
      }}
    />
  );
}

export type MeetChatPaneStoryArgs = {
  draft: string;
  hasMessages: boolean;
};

export function MeetChatPaneStory({ draft: draftInitial, hasMessages }: MeetChatPaneStoryArgs) {
  const [draft, setDraft] = useState(draftInitial);
  return (
    <MeetStoryScope variant="chat-column">
      <MeetChatPane
        messages={hasMessages ? STORY_MEET_CHAT_MESSAGES : []}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => setDraft("")}
        onClose={STORY_NOOP}
      />
    </MeetStoryScope>
  );
}

export type MeetSelfPreviewPiPStoryArgs = {
  name: string;
  videoOn: boolean;
  micOn: boolean;
};

export function MeetSelfPreviewPiPStory({ name, videoOn, micOn }: MeetSelfPreviewPiPStoryArgs) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoOn || typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#20223a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#4f7cff";
    context.font = "24px sans-serif";
    context.fillText("Camera preview", 24, 48);
    const stream = canvas.captureStream(15);
    const node = videoRef.current;
    if (node) node.srcObject = stream;
    return () => {
      stream.getTracks().forEach((track) => track.stop());
      if (node) node.srcObject = null;
    };
  }, [videoOn]);

  return (
    <MeetStoryScope variant="pip-stage">
      <MeetSelfPreviewPiP
        name={name}
        videoOn={videoOn}
        micOn={micOn}
        videoRef={videoRef}
        onInfo={STORY_NOOP}
        onError={STORY_NOOP}
      />
    </MeetStoryScope>
  );
}
