export type MeetCallSpotlightPeer = {
  id: string;
  name: string;
  stream?: MediaStream | null;
  remoteMedia?: { camera: boolean; mic: boolean } | null;
  disclosedMedia?: { camera: boolean; mic: boolean; screen?: boolean } | null;
};

export function meetCallGivenName(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first || name;
}

/** Peer announced an active screen share (their video track carries the screen). */
export function meetCallPeerScreenSharing(peer: MeetCallSpotlightPeer): boolean {
  return peer.disclosedMedia?.screen === true;
}

export function meetCallPeerCameraOn(peer: MeetCallSpotlightPeer): boolean {
  // A screen share replaces the outbound video track, so the tile has live
  // video to show even when the camera toggle is off.
  if (peer.disclosedMedia) return peer.disclosedMedia.camera || peer.disclosedMedia.screen === true;
  if (peer.remoteMedia) return peer.remoteMedia.camera;
  return Boolean(peer.stream);
}

export function meetCallPeerMicOn(peer: MeetCallSpotlightPeer): boolean {
  if (peer.disclosedMedia) return peer.disclosedMedia.mic;
  if (peer.remoteMedia) return peer.remoteMedia.mic;
  return true;
}

export function pickMeetCallSpotlight<T extends MeetCallSpotlightPeer>(
  peers: readonly T[],
  self: T,
): T {
  // A remote screen share always takes the spotlight (the local share is
  // handled separately via `controller.screenOn` / `screenPreviewStream`).
  const sharing = peers.find((peer) => meetCallPeerScreenSharing(peer));
  if (sharing) return sharing;
  const speaking = peers.find((peer) => meetCallPeerMicOn(peer));
  return speaking ?? peers[0] ?? self;
}

export function meetCallStripPeers<T extends MeetCallSpotlightPeer>(
  spotlight: T,
  peers: readonly T[],
  self: T,
): T[] {
  return [self, ...peers].filter((peer) => peer.id !== spotlight.id);
}
