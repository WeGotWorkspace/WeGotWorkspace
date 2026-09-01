import { useMemo, useRef, useState } from "react";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createMeetChatOperations } from "@/lib/api/mock/meet-chat-operations";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_PEERS,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { STORY_NOOP } from "@/meet-core/stories/meet-story-shared";

export type MeetWorkspaceStoryArgs = {
  initialChannelId?: string;
  initialCallLayout?: MeetCallStageLayout;
  initialThreadId?: string | null;
};

function useMeetWorkspaceCallRoom(): MeetCallStageRoomProps {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const controller = createMeetStoryController(localVideoRef, {
    peers: STORY_MEET_PEERS,
    inCall: true,
    status: "in-call",
  });
  return {
    controller,
    displayName: controller.displayName,
    hasSignedInIdentity: true,
    participantCount: STORY_MEET_PEERS.length + 1,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera: STORY_MEET_DEVICES[0]!.id,
    activeMic: STORY_MEET_MICROPHONES[0]!.id,
    activeSpeaker,
    onSpeakerChange: setActiveSpeaker,
    onCopyLink: STORY_NOOP,
    onMuteSoon: STORY_NOOP,
    onToastInfo: STORY_NOOP,
    onToastError: STORY_NOOP,
  };
}

export function MeetWorkspaceStoryHarness({
  initialChannelId,
  initialCallLayout = "collapsed",
  initialThreadId = null,
}: MeetWorkspaceStoryArgs) {
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  const operations = useMemo(
    () =>
      createMeetChatOperations({
        channels: bootstrap.data.channels ?? [],
        messages: bootstrap.data.messages ?? [],
        unfurl: bootstrap.data.unfurl,
        directory: bootstrap.data.directory,
        author: {
          id: bootstrap.session.user.username ?? "demo.user",
          displayName: bootstrap.session.user.displayName,
        },
      }),
    [bootstrap],
  );
  const callStageRoom = useMeetWorkspaceCallRoom();

  return (
    <MeetWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      operations={operations}
      onLogout={() => {}}
      initialChannelId={initialChannelId}
      initialCallLayout={initialCallLayout}
      initialThreadId={initialThreadId}
      callStageRoom={callStageRoom}
    />
  );
}
