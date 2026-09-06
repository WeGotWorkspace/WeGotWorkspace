import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { STORY_NOOP } from "@/meet-core/stories/meet-story-shared";

export type MeetWorkspaceStoryArgs = {
  initialChannelId?: string;
  initialCallLayout?: MeetCallStageLayout;
  initialThreadId?: string | null;
  initialVideoOn?: boolean;
  /** Mock-tier typing fixture (channel id -> directory user ids). */
  typingByChannel?: Record<string, string[]>;
  /** Mock-tier knock fixture (chunk I): non-members waiting on the knock path. */
  initialKnockers?: { id: string; name: string }[];
  /** Start with this user knocking — waiting to be let in (chunk I). */
  initialWaitingForAdmission?: boolean;
};

const STORY_BAR_PEERS = [
  {
    id: "felix.bauer",
    name: "Felix Bauer",
    stream: null,
    connectionState: "connected" as const,
    remoteMedia: null,
    disclosedMedia: { camera: false, mic: true },
  },
  {
    id: "maya.lindqvist",
    name: "Maya Lindqvist",
    stream: null,
    connectionState: "connected" as const,
    remoteMedia: null,
    disclosedMedia: { camera: false, mic: false },
  },
  {
    id: "jonas.pereira",
    name: "Jonas Pereira",
    stream: null,
    connectionState: "connected" as const,
    remoteMedia: null,
    disclosedMedia: { camera: false, mic: false },
  },
];

function useMeetWorkspaceCallRoom(
  videoOn: boolean,
  setVideoOn: Dispatch<SetStateAction<boolean>>,
  initialKnockers: { id: string; name: string }[] = [],
  initialWaitingForAdmission = false,
): MeetCallStageRoomProps {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const [activeCamera, setActiveCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [activeMic, setActiveMic] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [micOn, setMicOn] = useState(true);
  // Knock fixtures stay stateful so admit/deny/cancel interactions play out.
  const [knockers, setKnockers] = useState(initialKnockers);
  const [waitingForAdmission, setWaitingForAdmission] = useState(initialWaitingForAdmission);
  const resolveKnocker = async (peerId: string) => {
    setKnockers((current) => current.filter((entry) => entry.id !== peerId));
  };
  const controller = createMeetStoryController(localVideoRef, {
    peers: waitingForAdmission ? [] : STORY_BAR_PEERS,
    micOn,
    videoOn,
    setVideoOn,
    toggleMic: () => setMicOn((on) => !on),
    toggleVideo: () => setVideoOn((on) => !on),
    switchCamera: async (deviceId) => setActiveCamera(deviceId),
    switchMic: async (deviceId) => setActiveMic(deviceId),
    knockers,
    waitingForAdmission,
    admitKnocker: resolveKnocker,
    denyKnocker: resolveKnocker,
    leave: async () => setWaitingForAdmission(false),
    inCall: !waitingForAdmission,
    status: waitingForAdmission ? "waiting" : "in-call",
    elapsedLabel: "2:18",
  });
  return {
    controller,
    displayName: controller.displayName,
    hasSignedInIdentity: true,
    participantCount: waitingForAdmission ? 0 : STORY_BAR_PEERS.length + 1,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera,
    activeMic,
    activeSpeaker,
    onSpeakerChange: setActiveSpeaker,
    onCopyLink: STORY_NOOP,
    onToastInfo: STORY_NOOP,
    onToastError: STORY_NOOP,
  };
}

export function MeetWorkspaceStoryHarness({
  initialChannelId,
  initialCallLayout = "collapsed",
  initialThreadId = null,
  initialVideoOn = false,
  typingByChannel,
  initialKnockers,
  initialWaitingForAdmission = false,
}: MeetWorkspaceStoryArgs) {
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  const [videoOn, setVideoOn] = useState(initialVideoOn);
  useEffect(() => {
    setVideoOn(initialVideoOn);
  }, [initialVideoOn]);
  const operations = useMemo(() => {
    const base = createMeetChatOperations({
      channels: bootstrap.data.channels ?? [],
      messages: bootstrap.data.messages ?? [],
      unfurl: bootstrap.data.unfurl,
      directory: bootstrap.data.directory,
      author: {
        id: bootstrap.session.user.username ?? "demo.user",
        displayName: bootstrap.session.user.displayName,
      },
    });
    return {
      ...base,
      startCall: async (channelId: string, options?: { video?: boolean }) => {
        if (options?.video === false) setVideoOn(false);
        await base.startCall?.(channelId, options);
      },
    };
  }, [bootstrap]);
  const callStageRoom = useMeetWorkspaceCallRoom(
    videoOn,
    setVideoOn,
    initialKnockers,
    initialWaitingForAdmission,
  );

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
      typingByChannel={typingByChannel}
      callParticipantsByChannel={{
        "channel-general": ["ada.lovelace", "grace.hopper", "alan.turing"],
      }}
    />
  );
}
