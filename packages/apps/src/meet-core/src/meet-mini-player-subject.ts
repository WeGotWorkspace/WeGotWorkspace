import { shouldMirrorMeetStream } from "@/meet-core/src/meet-stream-mirror";

/** Smoothed speech level (0–1) that counts as talking. */
export const MEET_MINI_PLAYER_SPEECH_ON = 0.2;
/**
 * Someone must clear the current subject by this much before the preview
 * switches. Stops the card flipping every sample when two people talk over
 * each other, and keeps room echo on the local mic from stealing a remote
 * speaker.
 */
export const MEET_MINI_PLAYER_SWITCH_MARGIN = 0.15;

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
 * While the current subject is still at or above the speech threshold, they
 * stay until someone else clears them by {@link MEET_MINI_PLAYER_SWITCH_MARGIN}.
 * A remote peer wins a tie, and the local user must be clearly louder than a
 * speaking remote before they take an empty preview. When nobody is above the
 * threshold, the previous subject stays while they remain in the call, so a
 * pause does not flip the preview back to the local user. With no history, a
 * remote peer is shown ahead of the local user.
 */
export function pickMeetMiniPlayerSubject(
  candidates: readonly MeetMiniPlayerCandidate[],
  previousId: string | null,
): MeetMiniPlayerCandidate | null {
  if (candidates.length === 0) return null;

  const previous = previousId
    ? candidates.find((candidate) => candidate.id === previousId)
    : undefined;
  const speaking = candidates.filter((candidate) => candidate.level >= MEET_MINI_PLAYER_SPEECH_ON);

  if (previous && previous.level >= MEET_MINI_PLAYER_SPEECH_ON) {
    const challengers = speaking.filter(
      (candidate) =>
        candidate.id !== previous.id &&
        candidate.level >= previous.level + MEET_MINI_PLAYER_SWITCH_MARGIN,
    );
    if (challengers.length === 0) return previous;
    return loudestHeard(challengers);
  }

  if (speaking.length > 0) return loudestHeard(speaking);

  if (previous) return previous;

  return candidates.find((candidate) => !candidate.isSelf) ?? candidates[0] ?? null;
}

function loudestHeard(pool: readonly MeetMiniPlayerCandidate[]): MeetMiniPlayerCandidate {
  const heard = pool.filter((candidate) => !localEcho(candidate, pool));
  const usable = heard.length > 0 ? heard : pool;
  return usable.reduce((best, candidate) => louderCandidate(best, candidate));
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
  return candidate.level < loudestRemote + MEET_MINI_PLAYER_SWITCH_MARGIN;
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

/**
 * Preview model for the mini-player. A silent screen share does not take the
 * card: the full stage spotlights a share, and this card follows who is talking.
 */
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
  const tracks = peer.stream?.getVideoTracks() ?? [];
  if (tracks.length === 0) return false;
  const disclosed = peer.disclosedMedia;
  if (disclosed) return disclosed.camera || disclosed.screen === true;
  if (peer.remoteMedia?.camera === false) return false;
  const track = tracks[0];
  return !!track && track.readyState === "live" && track.enabled !== false;
}
