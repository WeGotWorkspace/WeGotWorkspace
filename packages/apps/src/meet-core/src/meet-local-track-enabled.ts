/** Apply current mic/camera intent onto an already-captured local stream. */
export function syncMeetLocalTrackEnabled(
  stream: MediaStream | null | undefined,
  enabled: { mic: boolean; video: boolean },
): void {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) track.enabled = enabled.mic;
  for (const track of stream.getVideoTracks()) track.enabled = enabled.video;
}
