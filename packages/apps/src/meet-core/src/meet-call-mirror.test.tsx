/**
 * @vitest-environment jsdom
 */
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetCallExpanded } from "@/meet-core/src/meet-call-expanded";
import type { MeetRemotePeer } from "@/meet-core/src/meet-call-types";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";

function track(kind: "audio" | "video", settings: MediaTrackSettings = {}): MediaStreamTrack {
  return {
    kind,
    id: `${kind}-${Math.random().toString(36).slice(2)}`,
    label: "",
    readyState: "live",
    enabled: true,
    muted: false,
    getSettings: () => settings,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStreamTrack;
}

function streamOf(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
    getTracks: () => tracks,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStream;
}

const cameraStream = () => streamOf([track("audio"), track("video")]);
const screenStream = () =>
  streamOf([track("audio"), track("video", { displaySurface: "monitor" } as MediaTrackSettings)]);

function remote(
  id: string,
  name: string,
  stream: MediaStream,
  screenShare = false,
): MeetRemotePeer {
  const media = { camera: !screenShare, mic: true, screen: screenShare };
  return {
    id,
    name,
    stream,
    connectionState: "connected",
    remoteMedia: { camera: true, mic: true },
    disclosedMedia: media,
  };
}

function renderStage({
  displayName,
  signedIn,
  peers,
}: {
  displayName: string;
  signedIn: boolean;
  peers: MeetRemotePeer[];
}) {
  const local = cameraStream();
  const controller = createMeetStoryController(createRef<HTMLVideoElement>(), {
    peers,
    videoOn: true,
    micOn: true,
    displayName,
    getLocalStream: () => local,
  });
  return render(
    <TooltipProvider>
      <MeetCallExpanded
        monitorSpeech={false}
        controller={controller}
        displayName={displayName}
        hasSignedInIdentity={signedIn}
        participantCount={peers.length + 1}
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
}

/** Transform on the playing `<video>` inside the tile labelled `name`. */
function tileTransforms(container: HTMLElement, name: string): string[] {
  return [...container.querySelectorAll(".meet-peer-tile")]
    .filter((tile) => tile.querySelector(".meet-peer-tile__name")?.textContent === name)
    .map((tile) => tile.querySelector<HTMLVideoElement>("video.meet-stream-video"))
    .filter((video): video is HTMLVideoElement => video != null)
    .map((video) => video.style.transform);
}

describe("Meet call video mirroring", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
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

  it("mirrors only the member's own camera, not a guest's camera or a screen share", () => {
    const { container } = renderStage({
      displayName: "Demo User",
      signedIn: true,
      peers: [
        remote("guest-1", "Guest Visitor", cameraStream()),
        remote("peer-2", "Jamie Lee", screenStream(), true),
      ],
    });

    expect(tileTransforms(container, "Demo User")).toEqual(["scaleX(-1)"]);
    expect(tileTransforms(container, "Guest Visitor")).toEqual(["scaleX(1)"]);
    expect(tileTransforms(container, "Jamie Lee")).toEqual(["scaleX(1)"]);
  });

  it("mirrors only the guest's own camera, not a signed-in member's camera", () => {
    const { container } = renderStage({
      displayName: "Guest Visitor",
      signedIn: false,
      peers: [remote("member-1", "Alex Morgan", cameraStream())],
    });

    expect(tileTransforms(container, "Guest Visitor")).toEqual(["scaleX(-1)"]);
    expect(tileTransforms(container, "Alex Morgan")).toEqual(["scaleX(1)"]);
  });

  it("keeps a pinned remote camera unmirrored in the featured area", () => {
    const { container } = renderStage({
      displayName: "Demo User",
      signedIn: true,
      peers: [remote("guest-1", "Guest Visitor", cameraStream())],
    });

    fireEvent.click(
      screen.getAllByRole("button", { name: meetLabels.pinParticipant("Guest Visitor") })[0]!,
    );

    const main = container.querySelector<HTMLElement>(".meet-call-stage__share-main");
    expect(main).not.toBeNull();
    expect(tileTransforms(main!, "Guest Visitor")).toEqual(["scaleX(1)"]);
    expect(tileTransforms(container, "Demo User")).toEqual(["scaleX(-1)"]);
  });
});
