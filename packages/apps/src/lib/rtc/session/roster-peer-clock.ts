/**
 * How long a rostered peer may hold a room at the fast poll without a link.
 * A peer that can never link (a page that closed without its leave beacon, or
 * a browser whose WebRTC stays down) would otherwise keep the room polling at
 * the connecting cadence until the server times it out, or forever (#2156).
 */
export const UNLINKED_PEER_FAST_WINDOW_MS = 20_000;

/**
 * Remembers when each rostered peer appeared and when a link to it last
 * dropped. The poll cadence reads it to tell a peer that is still being
 * dialled from one that is not going to link.
 */
export class RosterPeerClock {
  private readonly pendingSince = new Map<string, number>();

  private readonly linked = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The roster a poll or join returned, without this peer itself. */
  noteRoster(peerIds: readonly string[]): void {
    const now = this.now();
    const next = new Set(peerIds);
    for (const id of next) {
      if (!this.pendingSince.has(id)) this.pendingSince.set(id, now);
    }
    for (const id of [...this.pendingSince.keys()]) {
      if (next.has(id)) continue;
      this.pendingSince.delete(id);
      this.linked.delete(id);
    }
  }

  /**
   * Milliseconds this peer has been waiting for a link. A link that drops
   * starts a fresh wait, so a reconnect gets the fast poll again.
   */
  private unlinkedForMs(peerId: string, linkedNow: boolean): number {
    const now = this.now();
    if (linkedNow) {
      this.linked.add(peerId);
      return 0;
    }
    if (this.linked.delete(peerId) || !this.pendingSince.has(peerId)) {
      this.pendingSince.set(peerId, now);
    }
    return now - (this.pendingSince.get(peerId) ?? now);
  }

  /** True while an unlinked peer is new enough to deserve the fast poll. */
  isDialing(peerId: string, linkedNow: boolean): boolean {
    if (linkedNow) {
      this.unlinkedForMs(peerId, true);
      return false;
    }
    return this.unlinkedForMs(peerId, false) < UNLINKED_PEER_FAST_WINDOW_MS;
  }

  /**
   * Records the links as they change, so a drop starts its wait now and not
   * at the next poll, which may be 40 s away. True when a link dropped.
   */
  noteLinks(peerIds: readonly string[], isLinked: (peerId: string) => boolean): boolean {
    let dropped = false;
    for (const id of peerIds) {
      const linkedNow = isLinked(id);
      if (!linkedNow && this.linked.has(id)) dropped = true;
      this.isDialing(id, linkedNow);
    }
    return dropped;
  }

  reset(): void {
    this.pendingSince.clear();
    this.linked.clear();
  }
}
