export function buildMeetAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function buildMeetVideoConstraints(deviceId?: string): MediaTrackConstraints {
  return deviceId
    ? { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: { exact: deviceId } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" };
}

/** getUserMedia args: audio-only joins must not open the camera. */
export function meetLocalMediaGumConstraints(input: {
  micOn: boolean;
  videoOn: boolean;
  micId?: string | null;
  camId?: string | null;
}): MediaStreamConstraints {
  return {
    audio: input.micOn ? buildMeetAudioConstraints(input.micId ?? undefined) : false,
    video: input.videoOn ? buildMeetVideoConstraints(input.camId ?? undefined) : false,
  };
}
