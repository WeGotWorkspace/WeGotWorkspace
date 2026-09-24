import { describe, expect, it } from "vitest";
import {
  buildMeetAudioConstraints,
  buildMeetVideoConstraints,
  meetLocalMediaGumConstraints,
} from "@/meet-core/src/meet-media-constraints";

describe("meet media constraints", () => {
  it("builds default audio constraints with echo cancellation", () => {
    expect(buildMeetAudioConstraints()).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it("pins audio and video to a selected device id", () => {
    expect(buildMeetAudioConstraints("mic-1")).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      deviceId: { exact: "mic-1" },
    });
    expect(buildMeetVideoConstraints("cam-1")).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: { exact: "cam-1" },
    });
  });

  it("uses facingMode for default video constraints", () => {
    expect(buildMeetVideoConstraints()).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    });
  });

  it("omits the camera when video is off", () => {
    expect(meetLocalMediaGumConstraints({ micOn: true, videoOn: false })).toEqual({
      audio: buildMeetAudioConstraints(),
      video: false,
    });
  });

  it("requests camera and mic when both are on", () => {
    expect(
      meetLocalMediaGumConstraints({
        micOn: true,
        videoOn: true,
        micId: "mic-1",
        camId: "cam-1",
      }),
    ).toEqual({
      audio: buildMeetAudioConstraints("mic-1"),
      video: buildMeetVideoConstraints("cam-1"),
    });
  });
});
