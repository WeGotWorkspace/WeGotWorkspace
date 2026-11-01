import type { PushHashes } from "./push-event-id";

/**
 * An app's reaction to pushed states for one account. Resolve `false` (or
 * throw) when the sync failed, so the hub keeps the old hash and the server
 * sends the type again; anything else confirms it.
 */
export type StateChangeListener = (
  states: Record<string, string>,
  accountId: string,
) => Promise<boolean | void> | boolean | void;

/** A pushed state and the hash of the event id it came with (null without one). */
export type PushedState = { state: string; hash: string | null };

/**
 * One subscription in one tab. It runs one sync at a time: pushes that arrive
 * while a sync runs only replace the states waiting for the next one, so an
 * older sync that fails can never roll back a hash a newer one confirmed.
 * Pushes in the same tick reach the listener as one call.
 */
export class StateChangeSubscription {
  readonly types: readonly string[];
  #listener: StateChangeListener;
  #onConfirmed: () => void;
  #confirmed: PushHashes = {};
  #waiting = new Map<string, Map<string, PushedState>>();
  #running = false;
  #scheduled = false;
  #disposed = false;

  constructor(types: readonly string[], listener: StateChangeListener, onConfirmed: () => void) {
    this.types = [...new Set(types)];
    this.#listener = listener;
    this.#onConfirmed = onConfirmed;
  }

  /** Hash per type of the last push this subscription synced successfully. */
  get confirmed(): Readonly<PushHashes> {
    return this.#confirmed;
  }

  offer(accountId: string, states: Record<string, PushedState>): void {
    if (this.#disposed) return;
    let waiting = this.#waiting.get(accountId);
    for (const type of this.types) {
      const pushed = states[type];
      if (!pushed) continue;
      if (!waiting) {
        waiting = new Map();
        this.#waiting.set(accountId, waiting);
      }
      waiting.set(type, pushed);
    }
    if (waiting) this.#schedule();
  }

  dispose(): void {
    this.#disposed = true;
    this.#waiting.clear();
  }

  #schedule(): void {
    if (this.#running || this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (!this.#disposed && this.#waiting.size > 0) {
        const [accountId, batch] = this.#waiting.entries().next().value!;
        this.#waiting.delete(accountId);
        const states = Object.fromEntries([...batch].map(([type, pushed]) => [type, pushed.state]));
        if (await this.#run(states, accountId)) this.#confirm(batch);
      }
    } finally {
      this.#running = false;
    }
  }

  async #run(states: Record<string, string>, accountId: string): Promise<boolean> {
    try {
      return (await this.#listener(states, accountId)) !== false;
    } catch {
      return false;
    }
  }

  #confirm(batch: Map<string, PushedState>): void {
    if (this.#disposed) return;
    let changed = false;
    for (const [type, pushed] of batch) {
      if (!pushed.hash || this.#confirmed[type] === pushed.hash) continue;
      this.#confirmed = { ...this.#confirmed, [type]: pushed.hash };
      changed = true;
    }
    if (changed) this.#onConfirmed();
  }
}
