import { describe, expect, it } from "vitest";
import { syncMeetLocalTrackEnabled } from "@/meet-core/src/meet-local-track-enabled";

function fakeTrack(kind: "audio" | "video", enabled = true) {
  return { kind, enabled };
}

describe("syncMeetLocalTrackEnabled", () => {
  it("sets audio and video track enabled flags from the current intent", () => {
    const audio = fakeTrack("audio", true);
    const video = fakeTrack("video", true);
    const stream = {
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    } as unknown as MediaStream;

    syncMeetLocalTrackEnabled(stream, { mic: true, video: false });

    expect(audio.enabled).toBe(true);
    expect(video.enabled).toBe(false);
  });

  it("is a no-op without a stream", () => {
    expect(() => syncMeetLocalTrackEnabled(null, { mic: false, video: false })).not.toThrow();
  });
});
