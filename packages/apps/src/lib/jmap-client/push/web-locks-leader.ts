/** The part of `navigator.locks` the push hub uses (injected for tests). */
export type WebLocks = {
  request(
    name: string,
    options: { mode?: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown>;
  query(): Promise<{
    held?: Array<{ name?: string; clientId?: string }>;
    pending?: Array<{ name?: string; clientId?: string }>;
  }>;
};

export function browserWebLocks(): WebLocks | null {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function" || typeof locks.query !== "function") {
    return null;
  }
  return locks as unknown as WebLocks;
}

/**
 * Queue for an exclusive Web Lock and run `lead` while this tab holds it.
 * The browser hands the lock to the next waiting tab when this one leaves or
 * closes, so exactly one tab per browser leads. Returns a leave function that
 * stops leading (calls the stop `lead` returned) or drops out of the queue.
 */
export function runWhileLeader(locks: WebLocks, name: string, lead: () => () => void): () => void {
  const queue = new AbortController();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let left = false;
  void locks
    .request(name, { mode: "exclusive", signal: queue.signal }, async () => {
      if (left) return;
      const stop = lead();
      try {
        await held;
      } finally {
        stop();
      }
    })
    .catch(() => {
      // AbortError: left while still waiting in the queue.
    });
  return () => {
    if (left) return;
    left = true;
    queue.abort();
    release();
  };
}

/** Hold a Web Lock until the returned release runs (liveness and visibility markers). */
export function holdWebLock(locks: WebLocks, name: string): () => void {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(name, { mode: "exclusive" }, () => held).catch(() => undefined);
  return release;
}

/** Names of the locks currently held whose name starts with `prefix`, without it. */
export async function heldLockSuffixes(locks: WebLocks, prefix: string): Promise<Set<string>> {
  const snapshot = await locks.query();
  const suffixes = new Set<string>();
  for (const lock of snapshot.held ?? []) {
    if (lock.name?.startsWith(prefix)) suffixes.add(lock.name.slice(prefix.length));
  }
  return suffixes;
}
