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

export function meetCallPeerCameraOn(peer: MeetCallSpotlightPeer): boolean {
  if (peer.disclosedMedia) return peer.disclosedMedia.camera;
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
