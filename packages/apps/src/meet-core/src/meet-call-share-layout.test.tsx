/**
 * @vitest-environment jsdom
 */
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetCallExpanded } from "@/meet-core/src/meet-call-expanded";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_PEERS,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";

function stage(screenOn: boolean) {
  const controller = createMeetStoryController(createRef<HTMLVideoElement>(), {
    screenOn,
    peers: STORY_MEET_PEERS,
    videoOn: false,
    displayName: "Demo User",
  });
  return (
    <TooltipProvider>
      <MeetCallExpanded
        monitorSpeech={false}
        controller={controller}
        displayName="Demo User"
        hasSignedInIdentity
        participantCount={STORY_MEET_PEERS.length + 1}
        callExitLabel={meetLabels.leave}
        callExitTitle={meetLabels.leave}
        callExitDescription={meetLabels.leave}
        cameras={STORY_MEET_DEVICES}
        microphones={STORY_MEET_MICROPHONES}
        speakers={STORY_MEET_SPEAKERS}
        activeCamera={STORY_MEET_DEVICES[0]!.id}
        activeMic={STORY_MEET_MICROPHONES[0]!.id}
        activeSpeaker={STORY_MEET_SPEAKERS[0]!.id}
        onSpeakerChange={() => undefined}
        onCopyLink={() => undefined}
        onToastInfo={() => undefined}
        onToastError={() => undefined}
      />
    </TooltipProvider>
  );
}

function renderStage(screenOn: boolean) {
  return render(stage(screenOn));
}

describe("Meet call screen-share layout", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("keeps every participant, including the local speaker, in the filmstrip", () => {
    const { container } = renderStage(true);
    const filmstrip = container.querySelector(".meet-call-stage__share-peers");
    expect(filmstrip).not.toBeNull();
    expect(container.querySelector(".meet-call-stage__share-main")).not.toBeNull();
    expect(container.querySelector(".meet-call-stage__grid")).toBeNull();
    expect(screen.getByText(meetLabels.sharingScreen)).toBeTruthy();
    for (const name of ["Demo User", "Alex Morgan", "Jamie Lee"]) {
      expect(filmstrip?.textContent).toContain(name);
    }
  });

  it("uses the regular grid when nobody is sharing", () => {
    const { container } = renderStage(false);
    expect(container.querySelector(".meet-call-stage__share")).toBeNull();
    expect(container.querySelector(".meet-call-stage__grid")).not.toBeNull();
    expect(screen.getByText("Demo User")).toBeTruthy();
  });

  it("features one pinned peer and keeps them in the filmstrip", () => {
    const { container } = renderStage(false);

    fireEvent.click(screen.getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") }));

    const share = container.querySelector(".meet-call-stage__share");
    expect(share?.getAttribute("data-featured")).toBe("pin");
    const main = container.querySelector(".meet-call-stage__share-main");
    expect(main?.querySelector(".meet-peer-tile__display-name")).toBeNull();
    expect(main?.querySelector(".meet-peer-tile__name")?.textContent).toBe("Alex Morgan");
    const filmstrip = container.querySelector(".meet-call-stage__share-peers");
    for (const name of ["Demo User", "Alex Morgan", "Jamie Lee"]) {
      expect(filmstrip?.textContent).toContain(name);
    }
    expect(
      screen.getAllByRole("button", { name: meetLabels.unpinParticipant("Alex Morgan") }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: meetLabels.unpinParticipant("Jamie Lee") }),
    ).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", { name: meetLabels.pinParticipant("Jamie Lee") })[0]!,
    );
    expect(
      screen.queryByRole("button", { name: meetLabels.unpinParticipant("Alex Morgan") }),
    ).toBeNull();
    expect(container.querySelector(".meet-call-stage__share-main")?.textContent).toContain(
      "Jamie Lee",
    );
    expect(
      screen.getAllByRole("button", { name: meetLabels.unpinParticipant("Jamie Lee") }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByRole("button", { name: meetLabels.unpinParticipant("Jamie Lee") })[0]!,
    );
    expect(container.querySelector(".meet-call-stage__share")).toBeNull();
    expect(container.querySelector(".meet-call-stage__grid")).not.toBeNull();
  });

  it("keeps the screen share featured while a pin stays selected", () => {
    const { container, rerender } = renderStage(true);

    fireEvent.click(screen.getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") }));
    expect(container.querySelector(".meet-call-stage__share")?.getAttribute("data-featured")).toBe(
      "share",
    );
    expect(screen.getByText(meetLabels.sharingScreen)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: meetLabels.unpinParticipant("Alex Morgan") })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(stage(false));
    expect(container.querySelector(".meet-call-stage__share")?.getAttribute("data-featured")).toBe(
      "pin",
    );
    expect(screen.queryByText(meetLabels.sharingScreen)).toBeNull();
    expect(container.querySelector(".meet-call-stage__share-main")?.textContent).toContain(
      "Alex Morgan",
    );
    expect(container.querySelector(".meet-call-stage__share-peers")?.textContent).toContain(
      "Alex Morgan",
    );
  });

  it("plays a pinned remote through exactly one video", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const alex = mediaStream();
    const jamie = mediaStream();
    const self = mediaStream();
    const controller = createMeetStoryController(createRef<HTMLVideoElement>(), {
      screenOn: false,
      peers: [
        { ...STORY_MEET_PEERS[0]!, stream: alex },
        { ...STORY_MEET_PEERS[1]!, stream: jamie },
      ],
      getLocalStream: () => self,
      videoOn: false,
      displayName: "Demo User",
    });
    const { container } = render(
      <TooltipProvider>
        <MeetCallExpanded
          monitorSpeech={false}
          controller={controller}
          displayName="Demo User"
          hasSignedInIdentity
          participantCount={3}
          callExitLabel={meetLabels.leave}
          callExitTitle={meetLabels.leave}
          callExitDescription={meetLabels.leave}
          cameras={STORY_MEET_DEVICES}
          microphones={STORY_MEET_MICROPHONES}
          speakers={STORY_MEET_SPEAKERS}
          activeCamera={STORY_MEET_DEVICES[0]!.id}
          activeMic={STORY_MEET_MICROPHONES[0]!.id}
          activeSpeaker={STORY_MEET_SPEAKERS[0]!.id}
          onSpeakerChange={() => undefined}
          onCopyLink={() => undefined}
          onToastInfo={() => undefined}
          onToastError={() => undefined}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") }));

    const videos = [...container.querySelectorAll("video")];
    const bound = (stream: MediaStream) => videos.filter((node) => node.srcObject === stream);
    expect(bound(alex).filter((node) => !node.muted)).toHaveLength(1);
    expect(bound(alex).filter((node) => node.muted)).toHaveLength(1);
    expect(bound(jamie).filter((node) => !node.muted)).toHaveLength(1);
    expect(bound(jamie)).toHaveLength(1);
    expect(bound(self).filter((node) => !node.muted)).toHaveLength(0);
    expect(bound(self).length).toBeGreaterThan(0);
  });
});

function mediaStream(): MediaStream {
  const track = {
    kind: "audio",
    id: "audio",
    readyState: "live",
    enabled: true,
    muted: false,
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStream;
}
