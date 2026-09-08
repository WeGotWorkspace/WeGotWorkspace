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
    endedMessage?: string | null;
    showMissingInviteScreen?: boolean;
    showInviteCheckingScreen?: boolean;
    showWaitingForHostScreen?: boolean;
    showInviteErrorScreen?: boolean;
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
        endedMessage={overrides.endedMessage ?? null}
        showMissingInviteScreen={overrides.showMissingInviteScreen ?? false}
        showInviteCheckingScreen={overrides.showInviteCheckingScreen ?? false}
        showWaitingForHostScreen={overrides.showWaitingForHostScreen ?? false}
        showInviteErrorScreen={overrides.showInviteErrorScreen ?? false}
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
    expect(screen.getByText(meetLabels.knockNoAccount).getAttribute("aria-hidden")).toBeNull();
    expect(document.querySelector(".meet-guest-lobby__after-knock")).toBeTruthy();
    expect(document.querySelector(".meet-guest-lobby__card")).toBeTruthy();
    expect(document.querySelector(".meet-guest-lobby__card--status")).toBeNull();
    expect(document.querySelector(".meet-guest-lobby__media")).toBeTruthy();
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
    expect(screen.getByText(meetLabels.knockNoAccount).getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".meet-guest-lobby__after-knock")).toBeTruthy();
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

  it.each([
    {
      name: "checking",
      flags: { showInviteCheckingScreen: true },
      title: meetLabels.checkingInviteTitle,
      body: meetLabels.checkingInviteBody,
    },
    {
      name: "waiting for host",
      flags: { showWaitingForHostScreen: true },
      title: meetLabels.waitingForHostTitle,
      body: meetLabels.waitingForHostBody,
    },
    {
      name: "missing invite",
      flags: { showMissingInviteScreen: true },
      title: meetLabels.missingInviteTitle,
      body: meetLabels.missingInviteBody,
    },
    {
      name: "invite check error",
      flags: { showInviteErrorScreen: true },
      title: meetLabels.inviteErrorTitle,
      body: meetLabels.inviteErrorBody,
    },
  ] as const)("renders $name as a status variant of the invite card", ({ flags, title, body }) => {
    renderGuestLobby(flags);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(document.querySelector(".meet-guest-lobby__card--status")).toBeTruthy();
    expect(document.querySelector(".meet-guest-lobby__mark")).toBeTruthy();
    expect(document.querySelector(".meet-guest-lobby__media")).toBeNull();
    expect(screen.queryByText(meetLabels.cameraOff)).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.knockToJoin })).toBeNull();
    expect(screen.queryByText(meetLabels.invitedTitle)).toBeNull();
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
