import { describe, expect, it } from "vitest";
import {
  isDisplayCaptureVideoTrack,
  shouldMirrorMeetStream,
} from "@/meet-core/src/meet-stream-mirror";

function fakeVideoTrack(overrides: { label?: string; displaySurface?: string }): MediaStreamTrack {
  const settings: MediaTrackSettings = {};
  if (overrides.displaySurface) {
    (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface =
      overrides.displaySurface;
  }
  return {
    kind: "video",
    label: overrides.label ?? "",
    getSettings: () => settings,
  } as MediaStreamTrack;
}

describe("meet-stream-mirror", () => {
  it("detects display capture from displaySurface", () => {
    const track = fakeVideoTrack({ displaySurface: "monitor" });
    expect(isDisplayCaptureVideoTrack(track)).toBe(true);
  });

  it("detects display capture from label heuristics", () => {
    const track = fakeVideoTrack({ label: "screen:0:0" });
    expect(isDisplayCaptureVideoTrack(track)).toBe(true);
  });

  it("mirrors only the local camera, never a remote camera or a screen share", () => {
    const asStream = (track: MediaStreamTrack) =>
      ({ getVideoTracks: () => [track] }) as MediaStream;

    const camera = asStream(fakeVideoTrack({ label: "FaceTime HD Camera" }));
    const screen = asStream(fakeVideoTrack({ displaySurface: "monitor" }));

    // Local self-view reads like a mirror.
    expect(shouldMirrorMeetStream(camera, { local: true })).toBe(true);
    // A remote camera (guest or signed-in member) is shown the right way round.
    expect(shouldMirrorMeetStream(camera, { local: false })).toBe(false);
    // Screen share is never mirrored, local or remote.
    expect(shouldMirrorMeetStream(screen, { local: true })).toBe(false);
    expect(shouldMirrorMeetStream(screen, { local: false })).toBe(false);
    expect(shouldMirrorMeetStream(camera, { local: true, screen: true })).toBe(false);
    expect(shouldMirrorMeetStream(null, { local: true })).toBe(false);
  });
});
