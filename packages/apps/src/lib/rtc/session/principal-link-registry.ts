import type { CollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";

export type PrincipalLinkSend = (payload: unknown) => void;

export type PrincipalLink = {
  username: string;
  principalPeerId: string;
  send: PrincipalLinkSend;
};

export type PrincipalCollabReuseListener = (
  fromUsername: string,
  fromPrincipalPeerId: string,
  envelope: CollabReuseEnvelope,
) => void;

export type PrincipalLinkOpenListener = (username: string, principalPeerId: string) => void;

/**
 * Suite-level map of live principal-room data channels, keyed by Sabre username
 * (a user may have several tabs → several links). Collab sessions consult this
 * before dialing a fresh ICE association.
 */
export class PrincipalLinkRegistry {
  private readonly links = new Map<string, PrincipalLink>();

  private readonly listeners = new Set<PrincipalCollabReuseListener>();

  private readonly linkListeners = new Set<() => void>();

  private readonly linkOpenListeners = new Set<PrincipalLinkOpenListener>();

  private connectingUsernames = new Set<string>();

  registerLink(link: PrincipalLink): void {
    const wasLive = this.links.has(link.principalPeerId);
    this.links.set(link.principalPeerId, link);
    if (!wasLive) this.notifyLinkOpen(link.username, link.principalPeerId);
  }

  unregisterLink(principalPeerId: string): void {
    if (!this.links.delete(principalPeerId)) return;
    this.notifyLinks();
  }

  /** Drop links whose principal peer id is not in `liveIds` (DC closed / roster gone). */
  retain(liveIds: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.links.keys()]) {
      if (liveIds.has(id)) continue;
      this.links.delete(id);
      changed = true;
    }
    if (changed) this.notifyLinks();
  }

  linksForUsername(username: string): PrincipalLink[] {
    if (!username) return [];
    const matches: PrincipalLink[] = [];
    for (const link of this.links.values()) {
      if (link.username === username) matches.push(link);
    }
    return matches;
  }

  getLink(principalPeerId: string): PrincipalLink | null {
    return this.links.get(principalPeerId) ?? null;
  }

  hasOpenLink(username: string): boolean {
    return this.linksForUsername(username).length > 0;
  }

  /** Principal mesh is dialing this username but the data channel is not open yet. */
  isConnectingTo(username: string): boolean {
    return username !== "" && this.connectingUsernames.has(username);
  }

  /** Updated by the presence session on every roster / DC topology change. */
  setConnectingUsernames(usernames: ReadonlySet<string>): void {
    this.connectingUsernames = new Set(usernames);
  }

  sendToUsername(username: string, payload: unknown): number {
    const links = this.linksForUsername(username);
    for (const link of links) link.send(payload);
    return links.length;
  }

  sendToPrincipalPeer(principalPeerId: string, payload: unknown): boolean {
    const link = this.links.get(principalPeerId);
    if (!link) return false;
    link.send(payload);
    return true;
  }

  receive(fromUsername: string, fromPrincipalPeerId: string, envelope: CollabReuseEnvelope): void {
    for (const listener of this.listeners) {
      listener(fromUsername, fromPrincipalPeerId, envelope);
    }
  }

  subscribe(listener: PrincipalCollabReuseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fires when a live principal link is dropped (DC close / leave). */
  subscribeLinks(listener: () => void): () => void {
    this.linkListeners.add(listener);
    return () => {
      this.linkListeners.delete(listener);
    };
  }

  /** Fires when a principal data channel opens (collab can retry reuse immediately). */
  subscribeLinkOpen(listener: PrincipalLinkOpenListener): () => void {
    this.linkOpenListeners.add(listener);
    return () => {
      this.linkOpenListeners.delete(listener);
    };
  }

  private notifyLinks(): void {
    for (const listener of this.linkListeners) listener();
  }

  private notifyLinkOpen(username: string, principalPeerId: string): void {
    for (const listener of this.linkOpenListeners) {
      listener(username, principalPeerId);
    }
  }
}

let singleton = new PrincipalLinkRegistry();

export function getPrincipalLinkRegistry(): PrincipalLinkRegistry {
  return singleton;
}

export function resetPrincipalLinkRegistryForTests(): void {
  singleton = new PrincipalLinkRegistry();
}
