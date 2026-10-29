import { browserWebLocks, type WebLocks } from "@/lib/jmap-client/push/web-locks-leader";

const CLAIM_PREFIX = "wgw-notifications/local-ack/";

export type LocalAckClaims = {
  /** True when this tab may local-ack the row; false while another tab holds it. */
  claim(id: string): Promise<boolean>;
  /** Give the row back (ack failed, row no longer unread). */
  release(id: string): void;
  releaseAll(): void;
};

/**
 * Per-row Web Lock so two visible tabs never both local-ack the same row. The
 * claim is held until the row leaves the unread list or the tab closes; a
 * crashed tab's claims return to the others. Without Web Locks every claim
 * succeeds (the server ack is idempotent, so the cost is a duplicate POST).
 */
export function createLocalAckClaims(locks: WebLocks | null): LocalAckClaims {
  const held = new Map<string, () => void>();
  return {
    async claim(id) {
      if (!locks || held.has(id)) return true;
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const granted = await new Promise<boolean>((resolve) => {
        void locks
          .request(CLAIM_PREFIX + id, { mode: "exclusive", ifAvailable: true }, (lock) => {
            resolve(lock !== null);
            return lock ? hold : undefined;
          })
          .catch(() => resolve(false));
      });
      if (granted) held.set(id, release);
      return granted;
    },
    release(id) {
      held.get(id)?.();
      held.delete(id);
    },
    releaseAll() {
      for (const release of held.values()) release();
      held.clear();
    },
  };
}

/** A claim set for one mounted local-ack hook. */
export function defaultLocalAckClaims(): LocalAckClaims {
  return createLocalAckClaims(browserWebLocks());
}
