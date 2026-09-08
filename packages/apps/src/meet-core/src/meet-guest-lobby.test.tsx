import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetGuestLobby } from "@/meet-core/src/meet-guest-lobby";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";

function renderGuestLobby(
  overrides: {
    waitingForAdmission?: boolean;
    requestJoin?: () => Promise<void>;
    leave?: () => Promise<void>;
    toggleMic?: () => void;
    toggleVideo?: () => void;
    setDisplayName?: (value: string) => void;
  } = {},
) {
  const localVideoRef = createRef<HTMLVideoElement | null>();
  const requestJoin = overrides.requestJoin ?? vi.fn(async () => {});
  const leave = overrides.leave ?? vi.fn(async () => {});
  const toggleMic = overrides.toggleMic ?? vi.fn();
  const toggleVideo = overrides.toggleVideo ?? vi.fn();
  const setDisplayName = overrides.setDisplayName ?? vi.fn();
  const controller = createMeetStoryController(localVideoRef, {
    status: "idle",
    inCall: false,
    videoOn: false,
    micOn: true,
    displayName: "Wouter",
    setDisplayName,
    requestJoin,
    leave,
    toggleMic,
    toggleVideo,
  });

  render(
    <TooltipProvider>
      <MeetGuestLobby
        controller={controller}
        displayName="Wouter"
        inJoinFlow
        hasSignedInIdentity={false}
        invitedRoom="h8y8-ewp6-al8n"
        waitingForAdmission={overrides.waitingForAdmission ?? false}
        knockDots={1}
        cameras={STORY_MEET_DEVICES}
        microphones={STORY_MEET_MICROPHONES}
        speakers={STORY_MEET_SPEAKERS}
        activeCamera={STORY_MEET_DEVICES[0]!.id}
        activeMic={STORY_MEET_MICROPHONES[0]!.id}
        activeSpeaker={STORY_MEET_SPEAKERS[0]!.id}
        onSpeakerChange={() => {}}
        endedMessage={null}
        showMissingInviteScreen={false}
        showInviteCheckingScreen={false}
        showWaitingForHostScreen={false}
        showInviteErrorScreen={false}
        canStartReservedRoom={false}
        channelName="Design"
        channelTopic="Pixels, prototypes and critiques"
        channelKind="channel"
      />
    </TooltipProvider>,
  );

  return { requestJoin, leave, toggleMic, toggleVideo, setDisplayName };
}

describe("MeetGuestLobby", () => {
  it("shows the knock CTA on the ready card", () => {
    const { requestJoin } = renderGuestLobby();
    const heading = screen.getByRole("heading", { name: meetLabels.invitedTitle });
    const cameraOff = screen.getByText(meetLabels.cameraOff);
    expect(
      heading.compareDocumentPosition(cameraOff) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Wouter")).toBeTruthy();
    expect(screen.getByText(meetLabels.knockNoAccount)).toBeTruthy();
    expect(screen.queryByText("design")).toBeNull();
    expect(screen.queryByText(/Pixels, prototypes and critiques/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.knockToJoin }));
    expect(requestJoin).toHaveBeenCalledWith("h8y8-ewp6-al8n");
  });

  it("keeps the invite fields and disables knock while waiting", () => {
    const { leave } = renderGuestLobby({ waitingForAdmission: true });
    expect(screen.getByRole("heading", { name: meetLabels.invitedTitle })).toBeTruthy();
    expect(screen.getByText(meetLabels.cameraOff)).toBeTruthy();
    expect(screen.getByDisplayValue("Wouter")).toBeTruthy();
    const knock = screen.getByRole("button", { name: meetLabels.knockToJoin });
    expect((knock as HTMLButtonElement).disabled).toBe(true);
    expect(knock.className).toContain("meet-guest-lobby__knock--waiting");
    expect(knock.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText(meetLabels.knockNoAccount)).toBeNull();
    expect(screen.queryByText(meetLabels.knockWaitHint)).toBeNull();
    expect(screen.queryByText(meetLabels.knockingHint)).toBeNull();
    expect(screen.queryByText("design")).toBeNull();
    expect(document.querySelector(".user-avatar__presence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.cancelKnock }));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("wires the name input to controller.setDisplayName", () => {
    const { setDisplayName } = renderGuestLobby();
    fireEvent.change(screen.getByDisplayValue("Wouter"), { target: { value: "Ada" } });
    expect(setDisplayName).toHaveBeenCalledWith("Ada");
  });

  it("wires mic and camera circle toggles to controller handlers", () => {
    const { toggleMic, toggleVideo } = renderGuestLobby();
    fireEvent.click(screen.getByRole("button", { name: meetLabels.disableAudio }));
    fireEvent.click(screen.getByRole("button", { name: meetLabels.enableVideo }));
    expect(toggleMic).toHaveBeenCalledTimes(1);
    expect(toggleVideo).toHaveBeenCalledTimes(1);
  });

  it("keeps the local preview muted when the camera is on", () => {
    const localVideoRef = createRef<HTMLVideoElement | null>();
    const controller = createMeetStoryController(localVideoRef, {
      status: "idle",
      inCall: false,
      videoOn: true,
      displayName: "Wouter",
    });
    render(
      <TooltipProvider>
        <MeetGuestLobby
          controller={controller}
          displayName="Wouter"
          inJoinFlow
          hasSignedInIdentity={false}
          invitedRoom="h8y8-ewp6-al8n"
          waitingForAdmission={false}
          knockDots={1}
          cameras={STORY_MEET_DEVICES}
          microphones={STORY_MEET_MICROPHONES}
          speakers={STORY_MEET_SPEAKERS}
          activeCamera={STORY_MEET_DEVICES[0]!.id}
          activeMic={STORY_MEET_MICROPHONES[0]!.id}
          activeSpeaker={STORY_MEET_SPEAKERS[0]!.id}
          onSpeakerChange={() => {}}
          endedMessage={null}
          showMissingInviteScreen={false}
          showInviteCheckingScreen={false}
          showWaitingForHostScreen={false}
          showInviteErrorScreen={false}
          canStartReservedRoom={false}
          channelName="Design"
          channelKind="channel"
        />
      </TooltipProvider>,
    );
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.muted).toBe(true);
  });
});
