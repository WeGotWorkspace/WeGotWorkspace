/** Hold a signed ticket this long while the roster poll catches up. Stays under the ack timeout. */
export const COLLAB_REUSE_ROSTER_WAIT_MS = 1_000;

const MAX_ROSTER_WAITERS = 8;

type RosterWaitPorts = {
  isRostered: (collabPeerId: string) => boolean;
  requestRosterRefresh?: () => void;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
};

/**
 * Ticket envelopes that name a collab peer the roster does not list yet. Each
 * waits up to 1 s for a roster poll; at most eight peers wait at once.
 */
export class DocsCollabReuseRosterWait {
  private readonly waiters = new Map<string, Array<(ok: boolean) => void>>();

  private disposed = false;

  constructor(private readonly ports: RosterWaitPorts) {}

  wait(collabPeerId: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.ports.isRostered(collabPeerId)) return Promise.resolve(true);
    if (!this.waiters.has(collabPeerId) && this.waiters.size >= MAX_ROSTER_WAITERS) {
      return Promise.resolve(false);
    }
    this.ports.requestRosterRefresh?.();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.ports.clearTimeoutFn(timer);
        resolve(ok);
      };
      const timer = this.ports.setTimeoutFn(() => {
        const list = this.waiters.get(collabPeerId);
        if (list) {
          const rest = list.filter((fn) => fn !== finish);
          if (rest.length > 0) this.waiters.set(collabPeerId, rest);
          else this.waiters.delete(collabPeerId);
        }
        finish(false);
      }, COLLAB_REUSE_ROSTER_WAIT_MS);
      const list = this.waiters.get(collabPeerId) ?? [];
      list.push(finish);
      this.waiters.set(collabPeerId, list);
    });
  }

  /** A roster poll landed: release the waiters whose peer it lists. */
  flush(): void {
    for (const [id, list] of [...this.waiters]) {
      if (!this.ports.isRostered(id)) continue;
      this.waiters.delete(id);
      for (const finish of list) finish(true);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const list of this.waiters.values()) for (const finish of list) finish(false);
    this.waiters.clear();
  }
}
