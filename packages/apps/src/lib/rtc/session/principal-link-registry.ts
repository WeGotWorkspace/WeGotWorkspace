export type PrincipalLinkSend = (payload: unknown) => void;

export type PrincipalLink = {
  username: string;
  principalPeerId: string;
  send: PrincipalLinkSend;
};

/**
 * Suite-level map of live principal-room data channels, keyed by Sabre username
 * (a user may have several tabs → several links). Presence and Meet announce
 * over these links; Docs collaboration rides separate per-room channels on the
 * same principal peer connections (see `lib/rtc/link/`).
 */
/** Default wait for the suite principal mesh to finish signaling join before collab dials. */
export const PRINCIPAL_JOIN_WAIT_MS = 8000;

export class PrincipalLinkRegistry {
  private readonly links = new Map<string, PrincipalLink>();

  private connectingUsernames = new Set<string>();

  private principalJoinAttempted = false;

  private readonly principalJoinWaiters = new Set<() => void>();

  registerLink(link: PrincipalLink): void {
    this.links.set(link.principalPeerId, link);
  }

  /** Drop links whose principal peer id is not in `liveIds` (DC closed / roster gone). */
  retain(liveIds: ReadonlySet<string>): void {
    for (const id of [...this.links.keys()]) {
      if (liveIds.has(id)) continue;
      this.links.delete(id);
    }
  }

  private linksForUsername(username: string): PrincipalLink[] {
    if (!username) return [];
    const matches: PrincipalLink[] = [];
    for (const link of this.links.values()) {
      if (link.username === username) matches.push(link);
    }
    return matches;
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

  /** Called when the suite principal RTC session completes signaling join. */
  markPrincipalJoinAttempted(): void {
    if (this.principalJoinAttempted) return;
    this.principalJoinAttempted = true;
    for (const resolve of this.principalJoinWaiters) resolve();
    this.principalJoinWaiters.clear();
  }

  hasPrincipalJoinAttempted(): boolean {
    return this.principalJoinAttempted;
  }

  /**
   * Resolves once the principal mesh has joined signaling (or immediately when
   * already joined). Times out so guest/offline trees are not blocked forever.
   */
  waitForPrincipalJoinAttempt(
    timeoutMs = PRINCIPAL_JOIN_WAIT_MS,
    scheduleTimeout: typeof setTimeout = setTimeout.bind(globalThis),
  ): Promise<void> {
    if (this.principalJoinAttempted) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.principalJoinWaiters.delete(finish);
        resolve();
      };
      this.principalJoinWaiters.add(finish);
      scheduleTimeout(finish, timeoutMs);
    });
  }
}

let singleton = new PrincipalLinkRegistry();

export function getPrincipalLinkRegistry(): PrincipalLinkRegistry {
  return singleton;
}

export function resetPrincipalLinkRegistryForTests(): void {
  singleton = new PrincipalLinkRegistry();
}
