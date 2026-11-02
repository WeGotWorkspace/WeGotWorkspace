import type { WebLocks } from "../web-locks-leader";

type Waiter = {
  clientId: string;
  run: () => void;
  signal?: AbortSignal;
};

/**
 * In-memory Web Locks for tests: exclusive locks only, with `ifAvailable`,
 * `signal` and `query()`. One instance stands for one browser; `client(id)`
 * gives each fake tab its own view so `query()` reports who holds what.
 */
export class FakeWebLocks {
  #held = new Map<string, string>();
  #queues = new Map<string, Waiter[]>();
  #deferredPrefixes = new Set<string>();
  #deferred: Array<() => void> = [];

  client(clientId: string): WebLocks {
    return {
      request: (name, options, callback) => this.#request(clientId, name, options, callback),
      query: async () => ({
        held: [...this.#held].map(([name, holder]) => ({ name, clientId: holder })),
        pending: [...this.#queues].flatMap(([name, waiters]) =>
          waiters.map((waiter) => ({ name, clientId: waiter.clientId })),
        ),
      }),
    };
  }

  holder(name: string): string | undefined {
    return this.#held.get(name);
  }

  /**
   * Hold back grants of free locks whose name starts with `prefix` until the
   * returned function runs, as a real browser grants a request a while later.
   */
  deferGrants(prefix: string): () => void {
    this.#deferredPrefixes.add(prefix);
    return () => {
      this.#deferredPrefixes.delete(prefix);
      for (const grant of this.#deferred.splice(0)) grant();
    };
  }

  /** Drop every lock a tab holds, as the browser does when a tab crashes. */
  crash(clientId: string): void {
    for (const [name, holder] of [...this.#held]) {
      if (holder === clientId) this.#release(name);
    }
  }

  #request(
    clientId: string,
    name: string,
    options: { mode?: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.#held.set(name, clientId);
        Promise.resolve()
          .then(() => callback({ name }))
          .then(resolve, reject)
          .finally(() => {
            if (this.#held.get(name) === clientId) this.#release(name);
          });
      };
      if (!this.#held.has(name)) {
        if ([...this.#deferredPrefixes].some((prefix) => name.startsWith(prefix))) {
          this.#deferred.push(() => (this.#held.has(name) ? undefined : grant()));
        } else {
          grant();
        }
        return;
      }
      if (options.ifAvailable) {
        Promise.resolve()
          .then(() => callback(null))
          .then(resolve, reject);
        return;
      }
      if (options.signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const waiter: Waiter = { clientId, run: grant, signal: options.signal };
      const queue = this.#queues.get(name) ?? [];
      queue.push(waiter);
      this.#queues.set(name, queue);
      options.signal?.addEventListener("abort", () => {
        const current = this.#queues.get(name) ?? [];
        const index = current.indexOf(waiter);
        if (index < 0) return;
        current.splice(index, 1);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }

  #release(name: string): void {
    this.#held.delete(name);
    const next = this.#queues.get(name)?.shift();
    next?.run();
  }
}
