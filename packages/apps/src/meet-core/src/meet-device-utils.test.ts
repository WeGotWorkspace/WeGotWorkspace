import { describe, expect, it } from "vitest";
import {
  meetSpeakerOptionsFromAudioInputs,
  selectedMeetSpeakerOptionId,
  type MeetDeviceOption,
} from "@/meet-core/src/meet-device-utils";

const enumeratedSpeakers: MeetDeviceOption[] = [
  { id: "spk-built-in", label: "MacBook Pro Speakers", deviceId: "spk-built-in" },
  { id: "spk-hdmi", label: "HDMI", deviceId: "spk-hdmi" },
];

describe("selectedMeetSpeakerOptionId", () => {
  it("keeps a speaker the menu already lists", () => {
    expect(selectedMeetSpeakerOptionId(enumeratedSpeakers, "spk-hdmi")).toBe("spk-hdmi");
  });

  it("shows the enumerated speaker when the initial default id is not a menu item", () => {
    expect(selectedMeetSpeakerOptionId(enumeratedSpeakers, "default")).toBe("spk-built-in");
  });

  it("shows System default when that is the only option", () => {
    const systemDefault: MeetDeviceOption[] = [{ id: "default", label: "System default" }];
    expect(selectedMeetSpeakerOptionId(systemDefault, "default")).toBe("default");
  });

  it("falls back to the first speaker when the selected device disappeared", () => {
    expect(selectedMeetSpeakerOptionId(enumeratedSpeakers, "spk-gone")).toBe("spk-built-in");
  });
});

describe("meetSpeakerOptionsFromAudioInputs", () => {
  it("uses each device id, and System default only when the list is empty", () => {
    const devices = [
      { deviceId: "mic-1", label: "MacBook Pro Microphone", kind: "audioinput" },
    ] as MediaDeviceInfo[];

    expect(meetSpeakerOptionsFromAudioInputs(devices).map((option) => option.id)).toEqual([
      "mic-1",
    ]);
    expect(meetSpeakerOptionsFromAudioInputs([])).toEqual([
      { id: "default", label: "System default" },
    ]);
  });
});
