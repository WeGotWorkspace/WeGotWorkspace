/** True when the track is from getDisplayMedia (local or detectable on the receiver). */
export function isDisplayCaptureVideoTrack(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || track.kind !== "video") return false;

  const settings = track.getSettings?.() as MediaTrackSettings & {
    displaySurface?: string;
  };
  if (settings?.displaySurface) return true;

  const label = track.label.toLowerCase();
  return (
    label.includes("screen") ||
    label.includes("window") ||
    label.includes("display") ||
    label.includes("desktop")
  );
}

export function isDisplayCaptureStream(stream: MediaStream | null | undefined): boolean {
  return isDisplayCaptureVideoTrack(stream?.getVideoTracks()[0]);
}

/**
 * Only the local camera self-view is mirrored, so it reads like a mirror.
 * Every remote camera (guest or signed-in member) is shown the right way round,
 * the way the sender's camera sees them. Screen share is never mirrored.
 * `screen` is the disclosed share flag from control chat when known.
 */
export function shouldMirrorMeetStream(
  stream: MediaStream | null | undefined,
  source: { local: boolean; screen?: boolean | null },
): boolean {
  if (!stream || !source.local) return false;
  if (source.screen === true) return false;
  return !isDisplayCaptureStream(stream);
}
