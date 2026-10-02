import { describe, expect, it } from "vitest";
import {
  pickMeetMiniPlayerSubject,
  resolveMeetMiniPlayerPreview,
  type MeetMiniPlayerPreviewPeer,
  type MeetMiniPlayerPreviewSelf,
} from "@/meet-core/src/meet-mini-player-subject";

function track(kind: "audio" | "video", label = ""): MediaStreamTrack {
  return {
    kind,
    id: `${kind}-${label || "cam"}`,
    label,
    readyState: "live",
    enabled: true,
    muted: false,
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack;
}

function streamOf(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

const camera = streamOf([track("audio"), track("video")]);

const self: MeetMiniPlayerPreviewSelf = {
  id: "self",
  name: "Demo User",
  level: 0,
  videoOn: true,
  screenOn: false,
  stream: camera,
};

function peer(
  id: string,
  name: string,
  level: number,
  overrides: Partial<MeetMiniPlayerPreviewPeer> = {},
): MeetMiniPlayerPreviewPeer {
  return {
    id,
    name,
    level,
    stream: camera,
    remoteMedia: { camera: true, mic: true },
    disclosedMedia: { camera: true, mic: true },
    ...overrides,
  };
}

describe("pickMeetMiniPlayerSubject", () => {
  it("prefers a remote peer when speech levels tie", () => {
    const picked = pickMeetMiniPlayerSubject(
      [
        { id: "self", name: "Demo User", level: 0.4, isSelf: true },
        { id: "felix", name: "Felix Bauer", level: 0.4, isSelf: false },
      ],
      null,
    );
    expect(picked?.id).toBe("felix");
  });

  it("keeps a speaking remote peer when the local meter is only slightly louder", () => {
    const picked = pickMeetMiniPlayerSubject(
      [
        { id: "self", name: "Demo User", level: 0.5, isSelf: true },
        { id: "felix", name: "Felix Bauer", level: 0.4, isSelf: false },
      ],
      null,
    );
    expect(picked?.id).toBe("felix");
  });

  it("picks the local user when they are clearly louder than the remote peer", () => {
    const picked = pickMeetMiniPlayerSubject(
      [
        { id: "self", name: "Demo User", level: 0.9, isSelf: true },
        { id: "felix", name: "Felix Bauer", level: 0.4, isSelf: false },
      ],
      null,
    );
    expect(picked?.id).toBe("self");
  });

  it("holds the current remote until another peer is clearly louder", () => {
    const felix = { id: "felix", name: "Felix Bauer", level: 0.45, isSelf: false };
    const maya = { id: "maya", name: "Maya Lindqvist", level: 0.5, isSelf: false };
    const self = { id: "self", name: "Demo User", level: 0, isSelf: true };
    expect(pickMeetMiniPlayerSubject([self, felix, maya], "felix")?.id).toBe("felix");
    expect(pickMeetMiniPlayerSubject([self, felix, { ...maya, level: 0.7 }], "felix")?.id).toBe(
      "maya",
    );
  });

  it("keeps the previous speaker through silence and drops them after they leave", () => {
    const candidates = [
      { id: "self", name: "Demo User", level: 0, isSelf: true },
      { id: "maya", name: "Maya Lindqvist", level: 0, isSelf: false },
    ];
    expect(pickMeetMiniPlayerSubject(candidates, "felix")?.id).toBe("maya");
    expect(
      pickMeetMiniPlayerSubject(
        [{ id: "self", name: "Demo User", level: 0, isSelf: true }],
        "felix",
      )?.id,
    ).toBe("self");
  });
});

describe("resolveMeetMiniPlayerPreview", () => {
  it("previews the remote peer who is talking", () => {
    const felixStream = streamOf([track("audio"), track("video")]);
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("maya", "Maya Lindqvist", 0),
        peer("felix", "Felix Bauer", 0.8, { stream: felixStream }),
      ],
      previousId: null,
    });
    expect(preview).toMatchObject({
      id: "felix",
      name: "Felix Bauer",
      stream: felixStream,
      showVideo: true,
      mirrored: true,
    });
  });

  it("previews the local user when they are the one talking", () => {
    const preview = resolveMeetMiniPlayerPreview({
      self: { ...self, level: 0.9 },
      peers: [peer("felix", "Felix Bauer", 0.1)],
      previousId: null,
    });
    expect(preview?.id).toBe("self");
    expect(preview?.showVideo).toBe(true);
    expect(preview?.mirrored).toBe(true);
    expect(preview?.stream).toBe(self.stream);
  });

  it("keeps the last speaker through a pause instead of flipping to the local user", () => {
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [peer("felix", "Felix Bauer", 0), peer("maya", "Maya Lindqvist", 0)],
      previousId: "felix",
    });
    expect(preview?.id).toBe("felix");
  });

  it("shows a remote peer before anyone talks", () => {
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [peer("maya", "Maya Lindqvist", 0), peer("felix", "Felix Bauer", 0)],
      previousId: null,
    });
    expect(preview?.id).toBe("maya");
  });

  it("shows the local user when they are alone", () => {
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [],
      previousId: null,
    });
    expect(preview?.id).toBe("self");
    expect(preview?.name).toBe("Demo User");
  });

  it("keeps the preview on one remote while the other is only slightly louder", () => {
    const felixStream = streamOf([track("audio"), track("video", "felix")]);
    const mayaStream = streamOf([track("audio"), track("video", "maya")]);
    const held = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("felix", "Felix Bauer", 0.46, { stream: felixStream }),
        peer("maya", "Maya Lindqvist", 0.5, { stream: mayaStream }),
      ],
      previousId: "felix",
    });
    expect(held?.id).toBe("felix");
    expect(held?.stream).toBe(felixStream);

    const taken = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("felix", "Felix Bauer", 0.4, { stream: felixStream }),
        peer("maya", "Maya Lindqvist", 0.7, { stream: mayaStream }),
      ],
      previousId: "felix",
    });
    expect(taken?.id).toBe("maya");
    expect(taken?.stream).toBe(mayaStream);
  });

  it("shows the talking peer's name without video when their camera is off", () => {
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("felix", "Felix Bauer", 0.8, {
          disclosedMedia: { camera: false, mic: true },
          remoteMedia: { camera: false, mic: true },
        }),
      ],
      previousId: null,
    });
    expect(preview).toMatchObject({
      id: "felix",
      name: "Felix Bauer",
      showVideo: false,
    });
  });

  it("waits for a video track when the camera is announced but not attached yet", () => {
    const audioOnly = streamOf([track("audio")]);
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("felix", "Felix Bauer", 0.8, {
          stream: audioOnly,
          disclosedMedia: { camera: true, mic: true },
        }),
      ],
      previousId: null,
    });
    expect(preview?.showVideo).toBe(false);
  });

  it("shows an unmirrored video when the talking peer is sharing their screen", () => {
    const screen = streamOf([track("video", "screen")]);
    const preview = resolveMeetMiniPlayerPreview({
      self,
      peers: [
        peer("felix", "Felix Bauer", 0.5, {
          stream: screen,
          disclosedMedia: { camera: false, mic: true, screen: true },
        }),
      ],
      previousId: null,
    });
    expect(preview).toMatchObject({
      id: "felix",
      showVideo: true,
      mirrored: false,
      stream: screen,
    });
  });

  it("hides the local camera when video is off or the screen is shared", () => {
    expect(
      resolveMeetMiniPlayerPreview({
        self: { ...self, videoOn: false, level: 0.8 },
        peers: [],
        previousId: null,
      })?.showVideo,
    ).toBe(false);
    expect(
      resolveMeetMiniPlayerPreview({
        self: { ...self, screenOn: true, level: 0.8 },
        peers: [],
        previousId: null,
      })?.showVideo,
    ).toBe(false);
  });
});
