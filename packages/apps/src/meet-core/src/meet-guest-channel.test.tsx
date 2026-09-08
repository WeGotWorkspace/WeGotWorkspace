import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetGuestChannel } from "@/meet-core/src/meet-guest-channel";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-pane";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";

function guestLobby(waitingForAdmission: boolean): MeetLobbyPaneProps {
  const controller = createMeetStoryController(createRef<HTMLVideoElement | null>(), {
    status: waitingForAdmission ? "preparing" : "idle",
    inCall: waitingForAdmission,
    waitingForAdmission,
    videoOn: false,
    micOn: true,
    displayName: "Wouter",
  });
  return {
    controller,
    displayName: "Wouter",
    inJoinFlow: true,
    hasSignedInIdentity: false,
    invitedRoom: "h8y8-ewp6-al8n",
    waitingForAdmission,
    knockDots: 1,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera: STORY_MEET_DEVICES[0]!.id,
    activeMic: STORY_MEET_MICROPHONES[0]!.id,
    activeSpeaker: STORY_MEET_SPEAKERS[0]!.id,
    onSpeakerChange: () => {},
    endedMessage: null,
    showMissingInviteScreen: false,
    showInviteCheckingScreen: false,
    showWaitingForHostScreen: false,
    showInviteErrorScreen: false,
    canStartReservedRoom: false,
  };
}

function guestStage(lobby: MeetLobbyPaneProps): MeetCallStageRoomProps {
  return {
    controller: lobby.controller,
    displayName: lobby.displayName,
    hasSignedInIdentity: lobby.hasSignedInIdentity,
    participantCount: 1,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras: lobby.cameras,
    microphones: lobby.microphones,
    speakers: lobby.speakers,
    activeCamera: lobby.activeCamera,
    activeMic: lobby.activeMic,
    activeSpeaker: lobby.activeSpeaker,
    onSpeakerChange: lobby.onSpeakerChange,
    onCopyLink: () => {},
    onToastInfo: () => {},
    onToastError: () => {},
  };
}

describe("MeetGuestChannel knock wait", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("stays on the invite card when in-channel and waitingForAdmission both flip on", () => {
    const lobby = guestLobby(true);
    render(
      <MeetGuestChannel
        channelName="Design"
        phase="in-channel"
        lobby={lobby}
        stage={guestStage(lobby)}
      />,
    );
    expect(screen.getByRole("heading", { name: meetLabels.invitedTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.knockToJoin })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.cancelKnock })).toBeTruthy();
    expect(screen.queryByText(meetLabels.knockWaitHint)).toBeNull();
    expect(screen.queryByText(meetLabels.knockWaitTitle("Design"))).toBeNull();
    expect(screen.queryByText(meetLabels.knockingHint)).toBeNull();
    expect(document.querySelector(".meet-call-knock-wait")).toBeNull();
  });
});
