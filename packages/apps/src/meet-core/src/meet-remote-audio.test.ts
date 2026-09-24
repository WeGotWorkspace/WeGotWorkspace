import { describe, expect, it } from "vitest";
import { remoteParticipantHasAudio } from "@/meet-core/src/meet-remote-audio";

function fakeStream(kinds: Array<"audio" | "video">): MediaStream {
  return {
    getAudioTracks: () =>
      kinds.filter((kind) => kind === "audio").map(() => ({ kind: "audio" }) as MediaStreamTrack),
    getVideoTracks: () =>
      kinds.filter((kind) => kind === "video").map(() => ({ kind: "video" }) as MediaStreamTrack),
  } as MediaStream;
}

describe("remoteParticipantHasAudio", () => {
  it("is false for null/undefined streams", () => {
    expect(remoteParticipantHasAudio(null)).toBe(false);
    expect(remoteParticipantHasAudio(undefined)).toBe(false);
  });

  it("is false when the stream has no audio tracks", () => {
    expect(remoteParticipantHasAudio(fakeStream(["video"]))).toBe(false);
    expect(remoteParticipantHasAudio(fakeStream([]))).toBe(false);
  });

  it("is true when the stream has at least one audio track", () => {
    expect(remoteParticipantHasAudio(fakeStream(["audio"]))).toBe(true);
    expect(remoteParticipantHasAudio(fakeStream(["audio", "video"]))).toBe(true);
  });
});
