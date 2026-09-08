import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createMeetChatOperations } from "@/lib/api/mock/meet-chat-operations";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import { MeetChatColumn } from "@/meet-core/src/meet-chat-column";
import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-pane";
import { MeetGuestChannel, type MeetGuestChannelPhase } from "@/meet-core/src/meet-guest-channel";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { meetLocalMediaGumConstraints } from "@/meet-core/src/meet-media-constraints";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_PEERS,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";
import { STORY_NOOP } from "@/meet-core/stories/meet-story-shared";

type MeetStoryLobbyPreviewMedia = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  micOn: boolean;
  videoOn: boolean;
  toggleMic: () => void;
  toggleVideo: () => void;
  getLocalStream: () => MediaStream | null;
};

/** Story-only local preview: GUM when mic or camera is on; deny keeps camera-off + avatar. */
function useMeetStoryLobbyPreviewMedia(): MeetStoryLobbyPreviewMedia {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micWantedRef = useRef(true);
  const videoWantedRef = useRef(false);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(0);

  const getLocalStream = useCallback(() => {
    // Epoch changes when tracks are added to the same MediaStream object.
    void previewEpoch;
    return streamRef.current;
  }, [previewEpoch]);

  const syncTracks = useCallback((stream: MediaStream) => {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = micWantedRef.current;
    });
    stream.getVideoTracks().forEach((track) => {
      track.enabled = videoWantedRef.current;
    });
  }, []);

  const adoptPreviewStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      syncTracks(stream);
      setPreviewStream(stream);
      setPreviewEpoch((epoch) => epoch + 1);
    },
    [syncTracks],
  );

  const ensurePreviewMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const wantMic = micWantedRef.current;
    const wantVideo = videoWantedRef.current;
    if (!wantMic && !wantVideo) return streamRef.current;
    try {
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia(
          meetLocalMediaGumConstraints({
            micOn: wantMic,
            videoOn: wantVideo,
            micId: null,
            camId: null,
          }),
        );
        adoptPreviewStream(stream);
        return stream;
      }
      if (wantVideo && stream.getVideoTracks().length === 0) {
        const extra = await navigator.mediaDevices.getUserMedia(
          meetLocalMediaGumConstraints({
            micOn: false,
            videoOn: true,
            micId: null,
            camId: null,
          }),
        );
        extra.getVideoTracks().forEach((track) => stream!.addTrack(track));
      }
      if (wantMic && stream.getAudioTracks().length === 0) {
        const extra = await navigator.mediaDevices.getUserMedia(
          meetLocalMediaGumConstraints({
            micOn: true,
            videoOn: false,
            micId: null,
            camId: null,
          }),
        );
        extra.getAudioTracks().forEach((track) => stream!.addTrack(track));
      }
      adoptPreviewStream(stream);
      return stream;
    } catch {
      return null;
    }
  }, [adoptPreviewStream]);

  const toggleMic = useCallback(() => {
    const next = !micWantedRef.current;
    micWantedRef.current = next;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    if (next && (streamRef.current?.getAudioTracks().length ?? 0) === 0) {
      void ensurePreviewMedia();
    }
  }, [ensurePreviewMedia]);

  const toggleVideo = useCallback(() => {
    const next = !videoWantedRef.current;
    videoWantedRef.current = next;
    setVideoOn(next);
    if (!next) {
      streamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      return;
    }
    void ensurePreviewMedia().then((stream) => {
      if (stream || !videoWantedRef.current) return;
      videoWantedRef.current = false;
      setVideoOn(false);
    });
  }, [ensurePreviewMedia]);

  useEffect(() => {
    if (!micOn && !videoOn) return;
    void ensurePreviewMedia();
  }, [ensurePreviewMedia, micOn, videoOn]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !videoOn || !previewStream) return;
    video.srcObject = previewStream;
    video.muted = true;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [previewStream, videoOn]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { localVideoRef, micOn, videoOn, toggleMic, toggleVideo, getLocalStream };
}

const GUEST_CHANNEL_NAME = "Design";
const GUEST_CHANNEL_TOPIC = "Pixels, prototypes and critiques";
const GUEST_CHANNEL_KIND = "channel" as const;
const GUEST_ROOM_CODE = "h8y8-ewp6-al8n";

function buildStoryRoomSlice(
  localVideoRef: RefObject<HTMLVideoElement | null>,
  activeCamera: string,
  activeMic: string,
  activeSpeaker: string,
  onSpeakerChange: (value: string) => void,
  overrides?: Partial<MeetControllerState>,
): MeetCallStageRoomProps {
  const controller = createMeetStoryController(localVideoRef, overrides);
  return {
    controller,
    displayName: controller.displayName,
    hasSignedInIdentity: true,
    participantCount: controller.peers.length + 1,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera,
    activeMic,
    activeSpeaker,
    onSpeakerChange,
    onCopyLink: STORY_NOOP,
    onToastInfo: STORY_NOOP,
    onToastError: STORY_NOOP,
  };
}

function ChatPlaceholder({
  callActive,
  onToggleCall,
}: {
  callActive: boolean;
  onToggleCall: () => void;
}) {
  return (
    <div className="meet-call-stage__chat-placeholder">
      <p>{meetLabels.chatColumnPlaceholder}</p>
      <Button variant="primary" pill onClick={onToggleCall}>
        {callActive ? meetLabels.leaveCallStub : meetLabels.startCall}
      </Button>
    </div>
  );
}

export type MeetCallStageStoryArgs = {
  layout: MeetCallStageLayout;
  callActive: boolean;
  peerCount: number;
  defaultChatOpen?: boolean;
  sidebarOpen?: boolean;
};

export function MeetCallStageStoryHarness({
  layout: layoutInitial,
  callActive: callActiveInitial,
  peerCount,
  defaultChatOpen = true,
  sidebarOpen: sidebarOpenInitial = false,
}: MeetCallStageStoryArgs) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [layout, setLayout] = useState<MeetCallStageLayout>(layoutInitial);
  const [callActive, setCallActive] = useState(callActiveInitial);
  const [sidebarOpen, setSidebarOpen] = useState(sidebarOpenInitial);
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const [activeCamera, setActiveCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [activeMic, setActiveMic] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [chatOpen, setChatOpen] = useState(
    () => defaultChatOpen ?? defaultMeetWorkspacePanelOpen(),
  );

  useEffect(() => {
    setLayout(layoutInitial);
    setCallActive(callActiveInitial);
  }, [layoutInitial, callActiveInitial]);
  useEffect(() => {
    setChatOpen(defaultChatOpen ?? defaultMeetWorkspacePanelOpen());
  }, [defaultChatOpen]);
  const peers = STORY_MEET_PEERS.slice(
    0,
    Math.max(0, Math.min(peerCount, STORY_MEET_PEERS.length)),
  );
  const room = buildStoryRoomSlice(
    localVideoRef,
    activeCamera,
    activeMic,
    activeSpeaker,
    setActiveSpeaker,
    {
      peers: callActive ? peers : [],
      inCall: callActive,
      status: callActive ? "in-call" : "idle",
      switchCamera: async (deviceId) => setActiveCamera(deviceId),
      switchMic: async (deviceId) => setActiveMic(deviceId),
    },
  );
  const resolvedLayout: MeetCallStageLayout = callActive ? layout : "collapsed";
  const expanded = meetCallStageShowsStage(resolvedLayout);
  const chat = (
    <ChatPlaceholder
      callActive={callActive}
      onToggleCall={() => {
        setCallActive((active) => {
          const next = !active;
          if (next) setLayout("side-by-side");
          return next;
        });
      }}
    />
  );

  return (
    <MeetStoryScope variant="split">
      <TooltipProvider delayDuration={300}>
        <section className="workspace-app-layout__main">
          <MeetCallStage
            layout={resolvedLayout}
            channelTitle="#design"
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((open) => !open)}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            chat={expanded ? undefined : chat}
            onLayoutChange={(next) => {
              setLayout(next);
              if (next === "collapsed") setCallActive(false);
            }}
            {...room}
          />
        </section>
        {expanded ? (
          <MeetWorkspaceRail
            open={chatOpen}
            title={meetLabels.chatInChannel("#design")}
            closeLabel={meetLabels.chatClose}
            onClose={() => setChatOpen(false)}
          >
            {chat}
          </MeetWorkspaceRail>
        ) : null}
      </TooltipProvider>
    </MeetStoryScope>
  );
}

function buildStoryLobbySlice(
  localVideoRef: RefObject<HTMLVideoElement | null>,
  handlers: { onKnock: () => void; onCancelKnock: () => void },
  activeSpeaker: string,
  onSpeakerChange: (value: string) => void,
  identity: {
    displayName: string;
    hasSignedInIdentity: boolean;
    displayNameLocked: boolean;
    setDisplayName: (value: string) => void;
  } = {
    displayName: "Guest",
    hasSignedInIdentity: false,
    displayNameLocked: false,
    setDisplayName: () => {},
  },
  media: Pick<
    MeetStoryLobbyPreviewMedia,
    "micOn" | "videoOn" | "toggleMic" | "toggleVideo" | "getLocalStream"
  >,
): MeetLobbyPaneProps {
  const knock = async () => {
    handlers.onKnock();
  };
  const controller = createMeetStoryController(localVideoRef, {
    status: "idle",
    inCall: false,
    videoOn: media.videoOn,
    micOn: media.micOn,
    displayName: identity.displayName,
    setDisplayName: (value) => {
      if (identity.displayNameLocked) return;
      const next = typeof value === "function" ? value(identity.displayName) : value;
      identity.setDisplayName(next);
    },
    startMeeting: knock,
    joinRoom: knock,
    requestJoin: knock,
    toggleMic: media.toggleMic,
    toggleVideo: media.toggleVideo,
    getLocalStream: media.getLocalStream,
    leave: async () => {
      handlers.onCancelKnock();
    },
  });

  return {
    controller,
    displayName: identity.displayName,
    inJoinFlow: true,
    hasSignedInIdentity: identity.hasSignedInIdentity,
    invitedRoom: GUEST_ROOM_CODE,
    waitingForAdmission: false,
    knockDots: 2,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera: STORY_MEET_DEVICES[0]!.id,
    activeMic: STORY_MEET_MICROPHONES[0]!.id,
    activeSpeaker,
    onSpeakerChange,
    endedMessage: null,
    showMissingInviteScreen: false,
    showInviteCheckingScreen: false,
    showWaitingForHostScreen: false,
    showInviteErrorScreen: false,
    canStartReservedRoom: false,
    displayNameLocked: identity.displayNameLocked,
  };
}

export type MeetGuestChannelStoryArgs = {
  phase: MeetGuestChannelPhase;
  callLayout: MeetCallStageLayout;
  displayName?: string;
  hasSignedInIdentity?: boolean;
  displayNameLocked?: boolean;
};

export function MeetGuestChannelStoryHarness({
  phase: phaseInitial,
  callLayout: callLayoutInitial,
  displayName = "Guest",
  hasSignedInIdentity = false,
  displayNameLocked = false,
}: MeetGuestChannelStoryArgs) {
  const preview = useMeetStoryLobbyPreviewMedia();
  const [phase, setPhase] = useState<MeetGuestChannelPhase>(phaseInitial);
  const [callLayout, setCallLayout] = useState<MeetCallStageLayout>(callLayoutInitial);
  const [guestName, setGuestName] = useState(displayName);

  useEffect(() => {
    setPhase(phaseInitial);
    setCallLayout(callLayoutInitial);
  }, [phaseInitial, callLayoutInitial]);
  useEffect(() => {
    setGuestName(displayName);
  }, [displayName]);
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const [activeCamera, setActiveCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [activeMic, setActiveMic] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const lobby = buildStoryLobbySlice(
    preview.localVideoRef,
    {
      onKnock: () => {
        setPhase("knocking");
      },
      onCancelKnock: () => {
        setPhase("lobby");
      },
    },
    activeSpeaker,
    setActiveSpeaker,
    {
      displayName: guestName,
      hasSignedInIdentity,
      displayNameLocked,
      setDisplayName: setGuestName,
    },
    {
      micOn: preview.micOn,
      videoOn: preview.videoOn,
      toggleMic: preview.toggleMic,
      toggleVideo: preview.toggleVideo,
      getLocalStream: preview.getLocalStream,
    },
  );
  const stage = buildStoryRoomSlice(
    preview.localVideoRef,
    activeCamera,
    activeMic,
    activeSpeaker,
    setActiveSpeaker,
    {
      peers: STORY_MEET_PEERS,
      displayName: guestName,
      switchCamera: async (deviceId) => setActiveCamera(deviceId),
      switchMic: async (deviceId) => setActiveMic(deviceId),
    },
  );

  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  const operations = useMemo(
    () =>
      createMeetChatOperations({
        channels: bootstrap.data.channels ?? [],
        messages: bootstrap.data.messages ?? [],
        unfurl: bootstrap.data.unfurl,
        directory: bootstrap.data.directory,
        author: { id: "guest", displayName: "Guest" },
      }),
    [bootstrap],
  );
  const chatSession = useMeetChatSession({
    initialMessages: bootstrap.data.messages ?? [],
    operations,
    selectedChannelId: "meeting-standup",
    author: { id: "guest", displayName: "Guest" },
    directory: bootstrap.data.directory ?? [],
  });
  const chat: ReactNode = (
    <MeetChatColumn
      messages={chatSession.channelMessages}
      currentUserId="guest"
      principals={bootstrap.data.directory ?? []}
      authorPresence={bootstrap.data.authorPresence}
      onSend={(payload) => {
        void chatSession.sendChannel(payload);
      }}
      onReact={(messageId, emoji) => {
        void chatSession.react(messageId, emoji);
      }}
      onReply={chatSession.openThread}
      onDelete={(messageId) => {
        void chatSession.deleteMessage(messageId);
      }}
    />
  );

  return (
    <MeetStoryScope>
      <MeetGuestChannel
        channelName={GUEST_CHANNEL_NAME}
        channelTopic={GUEST_CHANNEL_TOPIC}
        channelKind={GUEST_CHANNEL_KIND}
        phase={phase}
        lobby={lobby}
        stage={{ ...stage, displayName: guestName, hasSignedInIdentity }}
        callLayout={callLayout}
        chat={chat}
        onLayoutChange={setCallLayout}
      />
    </MeetStoryScope>
  );
}
