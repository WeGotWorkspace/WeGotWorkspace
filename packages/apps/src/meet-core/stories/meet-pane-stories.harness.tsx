import { useRef, useState } from "react";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-pane";
import { MeetLobbyPane } from "@/meet-core/src/meet-lobby-pane";
import type { MeetRoomPaneProps } from "@/meet-core/src/meet-room-pane";
import { MeetRoomPane } from "@/meet-core/src/meet-room-pane";
import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type DeviceSelection = {
  cameras: typeof STORY_MEET_DEVICES;
  microphones: typeof STORY_MEET_MICROPHONES;
  speakers: typeof STORY_MEET_SPEAKERS;
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
};

function useStoryDeviceSelection(): DeviceSelection & {
  setActiveSpeaker: (value: string) => void;
} {
  const [activeSpeaker, setActiveSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  return {
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera: STORY_MEET_DEVICES[0]!.id,
    activeMic: STORY_MEET_MICROPHONES[0]!.id,
    activeSpeaker,
    setActiveSpeaker,
  };
}

export function MeetLobbyPaneHarness(
  props: Partial<MeetLobbyPaneProps> & {
    controllerOverrides?: Partial<MeetControllerState>;
  },
) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const controller = createMeetStoryController(localVideoRef, props.controllerOverrides);
  const devices = useStoryDeviceSelection();
  const knockDots = props.knockDots ?? 2;

  return (
    <MeetStoryScope>
      <div className="meet-workspace__lobby flex-1 min-h-dvh">
        <MeetLobbyPane
          controller={controller}
          displayName={props.displayName ?? controller.displayName}
          inJoinFlow={props.inJoinFlow ?? false}
          hasSignedInIdentity={props.hasSignedInIdentity ?? true}
          invitedRoom={props.invitedRoom ?? null}
          waitingForAdmission={props.waitingForAdmission ?? false}
          knockDots={knockDots}
          cameras={props.cameras ?? devices.cameras}
          microphones={props.microphones ?? devices.microphones}
          speakers={props.speakers ?? devices.speakers}
          activeCamera={props.activeCamera ?? devices.activeCamera}
          activeMic={props.activeMic ?? devices.activeMic}
          activeSpeaker={props.activeSpeaker ?? devices.activeSpeaker}
          onSpeakerChange={props.onSpeakerChange ?? devices.setActiveSpeaker}
          endedMessage={props.endedMessage ?? null}
          showMissingInviteScreen={props.showMissingInviteScreen ?? false}
          showInviteCheckingScreen={props.showInviteCheckingScreen ?? false}
          showWaitingForHostScreen={props.showWaitingForHostScreen ?? false}
          showInviteErrorScreen={props.showInviteErrorScreen ?? false}
          canStartReservedRoom={props.canStartReservedRoom ?? props.hasSignedInIdentity ?? true}
        />
      </div>
    </MeetStoryScope>
  );
}

export function MeetRoomPaneHarness(
  props: Partial<MeetRoomPaneProps> & {
    controllerOverrides?: Partial<MeetControllerState>;
  },
) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const controller = createMeetStoryController(localVideoRef, props.controllerOverrides);
  const devices = useStoryDeviceSelection();
  const [chatOpen, setChatOpen] = useState(props.chatOpen ?? false);

  return (
    <MeetStoryScope variant="in-call">
      <div
        className={
          chatOpen
            ? "meet-workspace__room meet-workspace__room--chat-open"
            : "meet-workspace__room meet-workspace__room--chat-closed"
        }
      >
        <MeetRoomPane
          controller={controller}
          displayName={props.displayName ?? controller.displayName}
          hasSignedInIdentity={props.hasSignedInIdentity ?? true}
          participantCount={props.participantCount ?? controller.peers.length + 1}
          chatOpen={chatOpen}
          onToggleChat={props.onToggleChat ?? (() => setChatOpen((open) => !open))}
          callExitLabel={props.callExitLabel ?? meetLabels.endCall}
          callExitTitle={props.callExitTitle ?? meetLabels.endCallTitle}
          callExitDescription={props.callExitDescription ?? meetLabels.endCallDescription}
          cameras={props.cameras ?? devices.cameras}
          microphones={props.microphones ?? devices.microphones}
          speakers={props.speakers ?? devices.speakers}
          activeCamera={props.activeCamera ?? devices.activeCamera}
          activeMic={props.activeMic ?? devices.activeMic}
          activeSpeaker={props.activeSpeaker ?? devices.activeSpeaker}
          onSpeakerChange={props.onSpeakerChange ?? devices.setActiveSpeaker}
          onCopyLink={props.onCopyLink ?? (() => {})}
          onMuteSoon={props.onMuteSoon ?? (() => {})}
          onToastInfo={props.onToastInfo ?? (() => {})}
          onToastError={props.onToastError ?? (() => {})}
        />
      </div>
    </MeetStoryScope>
  );
}
