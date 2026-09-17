import type { RtcPeerDescriptor } from "@/lib/rtc/types";

/** Identity key for collapsing leftover peers after a same-user reload. */
export function peerIdentityKey(
  peer: Pick<RtcPeerDescriptor, "name" | "user">,
  allowNameFallback: boolean,
): string | null {
  if (peer.user && peer.user !== "") return `u:${peer.user}`;
  if (allowNameFallback && peer.name !== "") return `n:${peer.name}`;
  return null;
}

export type CollapseStaleIdentityResult = {
  keep: RtcPeerDescriptor[];
  staleIds: string[];
};

/**
 * When the same user/display-name appears under a new peer id (tab reload),
 * drop the incumbent id so we do not offer to a ghost. Duplicates with no
 * replacement signal are left intact — the server roster is the source of truth.
 */
export function collapseStaleIdentityPeers(
  previous: RtcPeerDescriptor[],
  next: RtcPeerDescriptor[],
  allowNameFallback: boolean,
): CollapseStaleIdentityResult {
  const previousIds = new Set(previous.map((peer) => peer.id));
  const groups = new Map<string, RtcPeerDescriptor[]>();
  const ungrouped: RtcPeerDescriptor[] = [];

  for (const peer of next) {
    const key = peerIdentityKey(peer, allowNameFallback);
    if (!key) {
      ungrouped.push(peer);
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(peer);
    else groups.set(key, [peer]);
  }

  const keep: RtcPeerDescriptor[] = [...ungrouped];
  const staleIds: string[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      keep.push(group[0]!);
      continue;
    }
    const incumbents = group.filter((peer) => previousIds.has(peer.id));
    const newcomers = group.filter((peer) => !previousIds.has(peer.id));
    if (newcomers.length > 0 && incumbents.length > 0) {
      keep.push(...newcomers);
      for (const peer of incumbents) staleIds.push(peer.id);
      continue;
    }
    keep.push(...group);
  }

  return { keep, staleIds };
}

/**
 * Order principal-room dials: skip known ghosts, prefer peers without an active
 * PC, then newest peer id per username (random suffix rises on rejoin).
 */
export function sortPrincipalDialPeers(
  peers: RtcPeerDescriptor[],
  activePeerIds: Iterable<string>,
  droppedGhostIds: ReadonlySet<string>,
): RtcPeerDescriptor[] {
  const active = new Set(activePeerIds);
  return [...peers].sort((a, b) => {
    const aDropped = droppedGhostIds.has(a.id) ? 1 : 0;
    const bDropped = droppedGhostIds.has(b.id) ? 1 : 0;
    if (aDropped !== bDropped) return aDropped - bDropped;
    const aActive = active.has(a.id) ? 1 : 0;
    const bActive = active.has(b.id) ? 1 : 0;
    if (aActive !== bActive) return aActive - bActive;
    return b.id.localeCompare(a.id);
  });
}
