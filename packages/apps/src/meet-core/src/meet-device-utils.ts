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

export type MeetMediaDeviceLists = {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
};

/** Keep each `enumerateDevices()` kind on its own list. */
export function partitionMeetMediaDevices(
  devices: readonly MediaDeviceInfo[],
): MeetMediaDeviceLists {
  const audioInputs: MediaDeviceInfo[] = [];
  const audioOutputs: MediaDeviceInfo[] = [];
  const videoInputs: MediaDeviceInfo[] = [];
  for (const device of devices) {
    if (device.kind === "audioinput") audioInputs.push(device);
    else if (device.kind === "audiooutput") audioOutputs.push(device);
    else if (device.kind === "videoinput") videoInputs.push(device);
  }
  return { audioInputs, audioOutputs, videoInputs };
}

/** Speaker menu: audio outputs only. Inputs are never selectable here. */
export function meetSpeakerOptions(devices: readonly MediaDeviceInfo[]): MeetDeviceOption[] {
  const unique = new Map<string, MeetDeviceOption>();
  let idx = 0;
  for (const device of devices) {
    if (device.kind !== "audiooutput") continue;
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

export function meetCallDeviceMenus(devices: MeetMediaDeviceLists): {
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
} {
  return {
    cameras: normalizeMeetDeviceOptions("videoinput", devices.videoInputs),
    microphones: normalizeMeetDeviceOptions("audioinput", devices.audioInputs),
    speakers: meetSpeakerOptions(devices.audioOutputs),
  };
}

export function selectedMeetDeviceOptionId(
  options: MeetDeviceOption[],
  activeDeviceId: string | null | undefined,
): string {
  if (activeDeviceId) {
    const match = options.find(
      (option) => option.id === activeDeviceId || option.deviceId === activeDeviceId,
    );
    if (match) return match.id;
  }
  return options[0]?.id ?? "__none";
}

/** Option id from a speaker menu, or null when that id is not an output option. */
export function meetSpeakerSelectionId(
  speakers: readonly MeetDeviceOption[],
  optionId: string,
): string | null {
  const match = speakers.find((option) => option.id === optionId);
  if (!match) return null;
  return match.deviceId ?? match.id;
}

export function meetDeviceIdForOption(
  options: MeetDeviceOption[],
  optionId: string,
): string | null {
  const match = options.find((option) => option.id === optionId);
  return match?.deviceId ?? null;
}
