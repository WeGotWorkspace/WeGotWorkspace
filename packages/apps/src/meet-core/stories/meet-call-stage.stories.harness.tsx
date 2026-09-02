import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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

const GUEST_CHANNEL_NAME = "Standup";
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
    onMuteSoon: STORY_NOOP,
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
  onAdmit: () => void,
  activeSpeaker: string,
  onSpeakerChange: (value: string) => void,
): MeetLobbyPaneProps {
  const join = async () => {
    onAdmit();
  };
  const controller = createMeetStoryController(localVideoRef, {
    status: "idle",
    inCall: false,
    displayName: "Guest",
    startMeeting: join,
    joinRoom: join,
    requestJoin: join,
  });

  return {
    controller,
    displayName: "Guest",
    inJoinFlow: true,
    hasSignedInIdentity: false,
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
  };
}

export type MeetGuestChannelStoryArgs = {
  phase: MeetGuestChannelPhase;
  callLayout: MeetCallStageLayout;
};

export function MeetGuestChannelStoryHarness({
  phase: phaseInitial,
  callLayout: callLayoutInitial,
}: MeetGuestChannelStoryArgs) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<MeetGuestChannelPhase>(phaseInitial);
  const [callLayout, setCallLayout] = useState<MeetCallStageLayout>(callLayoutInitial);

  useEffect(() => {
    setPhase(phaseInitial);
    setCallLayout(callLayoutInitial);
  }, [phaseInitial, callLayoutInitial]);
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const [activeCamera, setActiveCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [activeMic, setActiveMic] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const lobby = buildStoryLobbySlice(
    localVideoRef,
    () => {
      setPhase("in-channel");
      setCallLayout("side-by-side");
    },
    activeSpeaker,
    setActiveSpeaker,
  );
  const stage = buildStoryRoomSlice(
    localVideoRef,
    activeCamera,
    activeMic,
    activeSpeaker,
    setActiveSpeaker,
    {
      peers: STORY_MEET_PEERS,
      displayName: "Guest",
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
    <MeetGuestChannel
      channelName={GUEST_CHANNEL_NAME}
      phase={phase}
      lobby={lobby}
      stage={{ ...stage, displayName: "Guest", hasSignedInIdentity: false }}
      callLayout={callLayout}
      chat={chat}
      onLayoutChange={setCallLayout}
    />
  );
}
