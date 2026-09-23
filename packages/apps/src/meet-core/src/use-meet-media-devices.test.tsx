/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMeetMediaDevices } from "@/meet-core/src/use-meet-media-devices";

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: "group",
    toJSON() {
      return { kind, deviceId, label, groupId: "group" };
    },
  };
}

describe("useMeetMediaDevices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores audio inputs and audio outputs separately", async () => {
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([
        device("audioinput", "mic-mac", "Default - MacBook Pro Microphone"),
        device("audiooutput", "spk-teams", "Microsoft Teams Audio Device (Virtual)"),
        device("videoinput", "cam-1", "FaceTime HD Camera"),
      ]);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useMeetMediaDevices());

    await waitFor(() => {
      expect(result.current.audioInputs.map((entry) => entry.deviceId)).toEqual(["mic-mac"]);
    });
    expect(result.current.audioOutputs.map((entry) => entry.deviceId)).toEqual(["spk-teams"]);
    expect(result.current.videoInputs.map((entry) => entry.deviceId)).toEqual(["cam-1"]);
  });
});
