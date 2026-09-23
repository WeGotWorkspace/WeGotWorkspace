import { describe, expect, it } from "vitest";
import {
  meetCallDeviceMenus,
  meetSpeakerOptions,
  meetSpeakerSelectionId,
  normalizeMeetDeviceOptions,
  partitionMeetMediaDevices,
  selectedMeetDeviceOptionId,
} from "@/meet-core/src/meet-device-utils";

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

const mixedDevices = [
  device("audioinput", "mic-mac", "Default - MacBook Pro Microphone"),
  device("audioinput", "mic-teams", "Microsoft Teams Audio"),
  device("audiooutput", "spk-mac", "MacBook Pro Speakers"),
  device("audiooutput", "spk-teams", "Microsoft Teams Audio Device (Virtual)"),
  device("videoinput", "cam-1", "FaceTime HD Camera"),
];

describe("partitionMeetMediaDevices", () => {
  it("splits microphones, speakers, and cameras by kind", () => {
    const partitioned = partitionMeetMediaDevices(mixedDevices);

    expect(partitioned.audioInputs.map((entry) => entry.deviceId)).toEqual([
      "mic-mac",
      "mic-teams",
    ]);
    expect(partitioned.audioOutputs.map((entry) => entry.deviceId)).toEqual([
      "spk-mac",
      "spk-teams",
    ]);
    expect(partitioned.videoInputs.map((entry) => entry.deviceId)).toEqual(["cam-1"]);
  });
});

describe("meet call device menus", () => {
  it("lists microphones only under Microphone and speakers only under Speaker", () => {
    const menus = meetCallDeviceMenus(partitionMeetMediaDevices(mixedDevices));

    expect(menus.microphones.map((option) => option.label)).toEqual([
      "Default - MacBook Pro Microphone",
      "Microsoft Teams Audio",
    ]);
    expect(menus.speakers.map((option) => option.label)).toEqual([
      "MacBook Pro Speakers",
      "Microsoft Teams Audio Device (Virtual)",
    ]);
    expect(menus.cameras.map((option) => option.label)).toEqual(["FaceTime HD Camera"]);
    const microphoneIds = new Set(menus.microphones.map((option) => option.deviceId));
    for (const speaker of menus.speakers) {
      expect(microphoneIds.has(speaker.deviceId)).toBe(false);
    }
  });

  it("selects a speaker only when the option is an audio output", () => {
    const menus = meetCallDeviceMenus(partitionMeetMediaDevices(mixedDevices));
    const speaker = menus.speakers[1]!;
    const microphone = menus.microphones[0]!;

    expect(meetSpeakerSelectionId(menus.speakers, speaker.id)).toBe(speaker.deviceId);
    expect(meetSpeakerSelectionId(menus.speakers, microphone.id)).toBeNull();
    expect(selectedMeetDeviceOptionId(menus.speakers, speaker.deviceId)).toBe(speaker.id);
    expect(selectedMeetDeviceOptionId(menus.microphones, microphone.deviceId)).toBe(microphone.id);
  });

  it("shows the enumerated speaker when the initial default id is not a menu item", () => {
    const menus = meetCallDeviceMenus(partitionMeetMediaDevices(mixedDevices));
    expect(selectedMeetDeviceOptionId(menus.speakers, "default")).toBe(menus.speakers[0]!.id);
  });

  it("does not treat microphones as speakers", () => {
    expect(meetSpeakerOptions(mixedDevices.filter((entry) => entry.kind === "audioinput"))).toEqual(
      [{ id: "default", label: "System default" }],
    );
  });

  it("does not treat speakers as microphones", () => {
    expect(
      normalizeMeetDeviceOptions(
        "audioinput",
        mixedDevices.filter((entry) => entry.kind === "audiooutput"),
      ),
    ).toEqual([{ id: "__none:audioinput", label: "No microphone detected" }]);
  });

  it("keeps a system-default speaker when the browser lists no outputs", () => {
    expect(meetSpeakerOptions([])).toEqual([{ id: "default", label: "System default" }]);
  });
});
