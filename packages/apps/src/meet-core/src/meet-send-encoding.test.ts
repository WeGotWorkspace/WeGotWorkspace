import { describe, expect, it, vi } from "vitest";
import { VIDEO_PROFILE_SPECS } from "@/lib/rtc/video-profile";
import { applyMeetSendEncodings } from "@/meet-core/src/meet-send-encoding";
import type { VideoLimits } from "@/meet-core/src/meet-video-sender";

const limits: VideoLimits = { maxVideoProfile: "p720", maxVideoProfileRelay: "p360" };

function stats(relay: boolean): RTCStatsReport {
  const localId = "local";
  return new Map([
    [
      "pair",
      {
        type: "candidate-pair",
        selected: true,
        localCandidateId: localId,
      },
    ],
    ["local", { type: "local-candidate", candidateType: relay ? "relay" : "host" }],
  ]) as unknown as RTCStatsReport;
}

function sender() {
  const track = { kind: "video", id: "cam", enabled: true, contentHint: "" };
  const setParameters = vi.fn(async (_params: RTCRtpSendParameters) => {});
  return {
    track,
    setParameters,
    rtp: {
      track,
      getParameters: () => ({ encodings: [{}] }),
      setParameters,
    } as unknown as RTCRtpSender,
  };
}

function connection(relay: boolean, video: ReturnType<typeof sender>) {
  const createOffer = vi.fn();
  const pc = {
    getStats: vi.fn(async () => stats(relay)),
    getSenders: () => [video.rtp],
    createOffer,
    iceConnectionState: "connected",
  } as unknown as RTCPeerConnection;
  return { pc, createOffer };
}

describe("applyMeetSendEncodings", () => {
  it("lowers the encoding on a relay pair and restores it when the pair is direct", async () => {
    const video = sender();
    const relayed = connection(true, video);
    await applyMeetSendEncodings([relayed.pc], 1, limits, {
      lowData: false,
      screenMode: "text",
      screenTrackId: null,
    });
    expect(video.setParameters.mock.calls[0]?.[0].encodings?.[0]?.maxBitrate).toBe(
      VIDEO_PROFILE_SPECS.p360.maxBitrate,
    );

    const direct = connection(false, video);
    await applyMeetSendEncodings([direct.pc], 1, limits, {
      lowData: false,
      screenMode: "text",
      screenTrackId: null,
    });
    expect(video.setParameters.mock.calls.at(-1)?.[0].encodings?.[0]?.maxBitrate).toBe(
      VIDEO_PROFILE_SPECS.p720.maxBitrate,
    );
    expect(relayed.createOffer).not.toHaveBeenCalled();
    expect(direct.createOffer).not.toHaveBeenCalled();
  });

  it("changes the encoding for low data without a new offer", async () => {
    const video = sender();
    const direct = connection(false, video);
    await applyMeetSendEncodings([direct.pc], 1, limits, {
      lowData: false,
      screenMode: "text",
      screenTrackId: null,
    });
    await applyMeetSendEncodings([direct.pc], 1, limits, {
      lowData: true,
      screenMode: "text",
      screenTrackId: null,
    });
    const lowData = video.setParameters.mock.calls.at(-1)?.[0].encodings?.[0];
    expect(lowData?.maxBitrate).toBe(VIDEO_PROFILE_SPECS.p180.maxBitrate);
    expect(lowData?.scaleResolutionDownBy).toBe(4);
    expect(direct.createOffer).not.toHaveBeenCalled();
  });

  it("disables the camera sender when the instance ceiling is audio", async () => {
    const video = sender();
    const direct = connection(false, video);
    await applyMeetSendEncodings(
      [direct.pc],
      1,
      { maxVideoProfile: "audio", maxVideoProfileRelay: "audio" },
      { lowData: false, screenMode: "text", screenTrackId: null },
    );
    expect(video.track.enabled).toBe(false);
    expect(video.setParameters).not.toHaveBeenCalled();
    expect(direct.createOffer).not.toHaveBeenCalled();
  });
});
