import { decodeMeetKnockerName } from "@/meet-core/src/meet-control-messages";

export type MeetKnocker = {
  id: string;
  name: string;
};

export type MeetRosterPeer = {
  id: string;
  name: string;
};

export function listKnockersFromRoster(peers: MeetRosterPeer[]): MeetKnocker[] {
  return peers
    .map((peer) => {
      const name = decodeMeetKnockerName(peer.name);
      if (!name) return null;
      return { id: peer.id, name } satisfies MeetKnocker;
    })
    .filter((peer): peer is MeetKnocker => peer !== null);
}

/**
 * Every signaled roster row, knock names kept. `buildActiveMeetRoster` drops
 * the lobby; the offer gate has to see it to tell a knocker from an unknown id.
 */
export function buildMeetSignalingRoster(peers: MeetRosterPeer[]): Map<string, string> {
  return new Map(peers.map((peer) => [peer.id, peer.name]));
}

export function buildActiveMeetRoster(
  peers: MeetRosterPeer[],
  pendingKnockerIds: ReadonlySet<string>,
): Map<string, string> {
  const activeRoster = new Map<string, string>();
  for (const peer of peers) {
    if (pendingKnockerIds.has(peer.id)) continue;
    activeRoster.set(peer.id, peer.name);
  }
  return activeRoster;
}

export function listNewParticipantNames(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
  selfPeerId: string,
): string[] {
  const joined: string[] = [];
  next.forEach((name, id) => {
    if (id === selfPeerId) return;
    if (!previous.has(id)) joined.push(name);
  });
  return joined;
}
