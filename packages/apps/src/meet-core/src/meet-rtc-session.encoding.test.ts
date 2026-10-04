import { describe, expect, it, vi } from "vitest";
import type { CreateRtcSessionOptions } from "@/lib/rtc/session/create-rtc-session";
import { VIDEO_PROFILE_SPECS } from "@/lib/rtc/video-profile";
import { MeetRtcSession } from "@/meet-core/src/meet-rtc-session";

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn(),
}));

import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";

function videoSender() {
  const track = { kind: "video", id: "cam", enabled: true, contentHint: "" };
  const setParameters = vi.fn(async (_params: RTCRtpSendParameters) => {});
  return {
    track,
    setParameters,
    rtp: {
      track,
      getParameters: () => ({ encodings: [{}] }),
      setParameters,
    },
  };
}

function meshFor(video: ReturnType<typeof videoSender>, limits: { maxVideoProfile: string }) {
  const pc = {
    iceConnectionState: "new" as RTCIceConnectionState,
    getStats: vi.fn(async () => new Map()),
    getSenders: () => [video.rtp],
    createOffer: vi.fn(),
  };
  let connected: ((remoteId: string) => void) | undefined;
  let link: (() => void) | undefined;
  vi.mocked(createRtcSession).mockImplementation((options: CreateRtcSessionOptions) => {
    connected = options.onPeerConnected;
    link = options.onLinkChange;
    return {
      join: vi.fn(async () => ({
        peerId: "me",
        peers: [{ id: "them", name: "Ada" }],
        sessionKey: null,
        limits: { limits },
      })),
      getPeerIds: () => ["them"],
      getPeerConnection: () => pc,
      getMyId: () => "me",
      getRemoteStream: () => null,
      getSessionKey: () => null,
      replaceVideoTrack: vi.fn(async () => {}),
      kickPoll: vi.fn(),
      leave: vi.fn(async () => {}),
      sendByeToAll: vi.fn(async () => {}),
    } as never;
  });
  return {
    pc,
    fireConnected: () => connected?.("them"),
    fireLink: () => {
      pc.iceConnectionState = "connected";
      link?.();
    },
  };
}

const settings = { stunUrls: "", turnAvailable: false, forceRelay: false };

describe("MeetRtcSession encodings", () => {
  it("runs setParameters when a peer connects and again after low data, with no offer", async () => {
    const video = videoSender();
    const mesh = meshFor(video, { maxVideoProfile: "p720" });
    const session = new MeetRtcSession({
      rtcSettings: settings,
      getLocalStream: () => null,
    });
    await session.join({ room: "room", peerId: "me", name: "Me" });
    mesh.fireConnected();
    await vi.waitFor(() => expect(video.setParameters).toHaveBeenCalled());
    const before = video.setParameters.mock.calls.length;
    session.setEncodingPrefs({ lowData: true });
    await vi.waitFor(() => expect(video.setParameters.mock.calls.length).toBeGreaterThan(before));
    expect(video.setParameters.mock.calls.at(-1)?.[0].encodings?.[0]?.maxBitrate).toBe(
      VIDEO_PROFILE_SPECS.p180.maxBitrate,
    );
    expect(mesh.pc.createOffer).not.toHaveBeenCalled();
  });

  it("re-checks the selected pair from getStats when ICE settles again", async () => {
    const video = videoSender();
    const mesh = meshFor(video, { maxVideoProfile: "p720" });
    mesh.pc.getStats.mockResolvedValue(
      new Map([
        ["pair", { type: "candidate-pair", selected: true, localCandidateId: "local" }],
        ["local", { type: "local-candidate", candidateType: "relay" }],
      ]) as never,
    );
    const session = new MeetRtcSession({
      rtcSettings: settings,
      getLocalStream: () => null,
    });
    await session.join({ room: "room", peerId: "me", name: "Me" });
    mesh.fireLink();
    await vi.waitFor(() => expect(video.setParameters).toHaveBeenCalled());
    expect(video.setParameters.mock.calls.at(-1)?.[0].encodings?.[0]?.maxBitrate).toBe(
      VIDEO_PROFILE_SPECS.p360.maxBitrate,
    );
  });

  it("disables the local camera when the join ceiling is audio", async () => {
    const video = videoSender();
    meshFor(video, { maxVideoProfile: "audio" });
    const track = { id: "cam", kind: "video", enabled: true } as MediaStreamTrack;
    const onVideoLimits = vi.fn();
    const session = new MeetRtcSession({
      rtcSettings: settings,
      getLocalStream: () => ({ getVideoTracks: () => [track] }) as MediaStream,
      onVideoLimits,
    });
    await session.join({ room: "room", peerId: "me", name: "Me" });
    expect(track.enabled).toBe(false);
    expect(onVideoLimits).toHaveBeenCalledWith(
      expect.objectContaining({ maxVideoProfile: "audio" }),
    );
    expect(session.isCameraSendingDisabled()).toBe(true);
  });
});
