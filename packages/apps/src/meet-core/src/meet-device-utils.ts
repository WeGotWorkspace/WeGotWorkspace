export type MeetDeviceOption = {
  id: string;
  label: string;
  deviceId?: string;
};

export function normalizeMeetDeviceOptions(
  kind: "audioinput" | "videoinput",
  devices: MediaDeviceInfo[],
): MeetDeviceOption[] {
  let fallbackIndex = 0;
  const options = devices
    .filter((device) => device.kind === kind)
    .map((device) => {
      fallbackIndex += 1;
      return {
        id: device.deviceId || `__device:${kind}:${fallbackIndex}`,
        label:
          device.label?.trim() ||
          (kind === "audioinput" ? `Microphone ${fallbackIndex}` : `Camera ${fallbackIndex}`),
        deviceId: device.deviceId || undefined,
      } satisfies MeetDeviceOption;
    });
  if (options.length > 0) return options;
  return [
    {
      id: `__none:${kind}`,
      label: kind === "audioinput" ? "No microphone detected" : "No camera detected",
    } satisfies MeetDeviceOption,
  ];
}

export function meetSpeakerOptionsFromAudioInputs(devices: MediaDeviceInfo[]): MeetDeviceOption[] {
  const unique = new Map<string, MeetDeviceOption>();
  let idx = 0;
  for (const device of devices) {
    idx += 1;
    const id = device.deviceId || `speaker-${idx}`;
    if (unique.has(id)) continue;
    unique.set(id, {
      id,
      label: device.label?.trim() || `Speaker ${idx}`,
      deviceId: device.deviceId || undefined,
    });
  }
  if (unique.size === 0) {
    unique.set("default", { id: "default", label: "System default" });
  }
  return [...unique.values()];
}

export function selectedMeetDeviceOptionId(
  options: MeetDeviceOption[],
  activeDeviceId: string | null | undefined,
): string {
  if (activeDeviceId) {
    const match = options.find((option) => option.deviceId === activeDeviceId);
    if (match) return match.id;
  }
  return options[0]?.id ?? "__none";
}

/** Menu value for the speaker row. `"default"` is the initial sink, not a device id. */
export function selectedMeetSpeakerOptionId(
  options: MeetDeviceOption[],
  speakerId: string | null | undefined,
): string {
  if (speakerId && options.some((option) => option.id === speakerId)) {
    return speakerId;
  }
  return options[0]?.id ?? "default";
}

export function meetDeviceIdForOption(
  options: MeetDeviceOption[],
  optionId: string,
): string | null {
  const match = options.find((option) => option.id === optionId);
  return match?.deviceId ?? null;
}
