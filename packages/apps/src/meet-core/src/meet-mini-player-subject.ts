import { shouldMirrorMeetStream } from "@/meet-core/src/meet-stream-mirror";

/** Smoothed speech level (0–1) that counts as talking. */
export const MEET_MINI_PLAYER_SPEECH_ON = 0.2;
/**
 * Local mic must clear the loudest speaking remote by this much before the
 * preview leaves that peer. Room echo often makes the local meter slightly
 * louder than the person actually talking.
 */
export const MEET_MINI_PLAYER_SELF_MARGIN = 0.15;

export type MeetMiniPlayerCandidate = {
  id: string;
  name: string;
  /** Smoothed 0–1 level. Callers pass 0 when that mic is off. */
  level: number;
  isSelf: boolean;
};

export type MeetMiniPlayerPreviewPeer = {
  id: string;
  name: string;
  level: number;
  stream: MediaStream | null;
  remoteMedia?: { camera: boolean; mic: boolean } | null;
  disclosedMedia?: { camera: boolean; mic: boolean; screen?: boolean } | null;
};

export type MeetMiniPlayerPreviewSelf = {
  id: string;
  name: string;
  level: number;
  videoOn: boolean;
  screenOn: boolean;
  stream: MediaStream | null;
};

export type MeetMiniPlayerPreview = {
  id: string;
  name: string;
  stream: MediaStream | null;
  showVideo: boolean;
  mirrored: boolean;
};

/**
 * Who the mini-player previews.
 *
 * The loudest candidate at or above the speech threshold wins. A remote peer
 * wins a tie, and the local user must be clearly louder before they replace
 * a speaking remote peer. When nobody is above the threshold, the previous
 * subject stays while they remain in the call, so a pause does not flip the
 * preview back to the local user. With no history, a remote peer is shown
 * ahead of the local user.
 */
export function pickMeetMiniPlayerSubject(
  candidates: readonly MeetMiniPlayerCandidate[],
  previousId: string | null,
): MeetMiniPlayerCandidate | null {
  if (candidates.length === 0) return null;

  const speaking = candidates.filter((candidate) => candidate.level >= MEET_MINI_PLAYER_SPEECH_ON);
  if (speaking.length > 0) {
    const heard = speaking.filter((candidate) => !localEcho(candidate, speaking));
    const pool = heard.length > 0 ? heard : speaking;
    return pool.reduce((best, candidate) => louderCandidate(best, candidate));
  }

  if (previousId) {
    const previous = candidates.find((candidate) => candidate.id === previousId);
    if (previous) return previous;
  }

  return candidates.find((candidate) => !candidate.isSelf) ?? candidates[0] ?? null;
}

function localEcho(
  candidate: MeetMiniPlayerCandidate,
  speaking: readonly MeetMiniPlayerCandidate[],
): boolean {
  if (!candidate.isSelf) return false;
  const loudestRemote = speaking.reduce(
    (loudest, item) => {
      if (item.isSelf) return loudest;
      return loudest === null || item.level > loudest ? item.level : loudest;
    },
    null as number | null,
  );
  if (loudestRemote === null) return false;
  return candidate.level < loudestRemote + MEET_MINI_PLAYER_SELF_MARGIN;
}

function louderCandidate(
  best: MeetMiniPlayerCandidate,
  candidate: MeetMiniPlayerCandidate,
): MeetMiniPlayerCandidate {
  if (candidate.level > best.level) return candidate;
  if (candidate.level < best.level) return best;
  if (best.isSelf && !candidate.isSelf) return candidate;
  if (!best.isSelf && candidate.isSelf) return best;
  return candidate.id < best.id ? candidate : best;
}

export function resolveMeetMiniPlayerPreview(input: {
  self: MeetMiniPlayerPreviewSelf;
  peers: readonly MeetMiniPlayerPreviewPeer[];
  previousId: string | null;
}): MeetMiniPlayerPreview | null {
  const peers = input.peers.filter((peer) => peer.id !== input.self.id);
  const picked = pickMeetMiniPlayerSubject(
    [
      {
        id: input.self.id,
        name: input.self.name,
        level: input.self.level,
        isSelf: true,
      },
      ...peers.map((peer) => ({
        id: peer.id,
        name: peer.name,
        level: peer.level,
        isSelf: false,
      })),
    ],
    input.previousId,
  );
  if (!picked) return null;
  if (picked.isSelf) {
    const showVideo = input.self.videoOn && !input.self.screenOn && input.self.stream != null;
    return {
      id: picked.id,
      name: picked.name,
      stream: input.self.stream,
      showVideo,
      mirrored: showVideo && shouldMirrorMeetStream(input.self.stream, false),
    };
  }

  const peer = peers.find((item) => item.id === picked.id);
  if (!peer) return null;
  const showVideo = remotePreviewHasVideo(peer);
  return {
    id: peer.id,
    name: peer.name,
    stream: peer.stream,
    showVideo,
    mirrored: showVideo && shouldMirrorMeetStream(peer.stream, peer.disclosedMedia?.screen),
  };
}

function remotePreviewHasVideo(peer: MeetMiniPlayerPreviewPeer): boolean {
  if (!peer.stream) return false;
  const disclosed = peer.disclosedMedia;
  if (disclosed) return disclosed.camera || disclosed.screen === true;
  if (peer.remoteMedia?.camera === false) return false;
  const track = peer.stream.getVideoTracks()[0];
  return !!track && track.readyState === "live" && track.enabled !== false;
}
