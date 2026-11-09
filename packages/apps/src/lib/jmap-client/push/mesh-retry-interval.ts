/**
 * The visible reconnect interval of the event source, by mesh state (#1943).
 *
 * While this browser's presence mesh has a linked peer, colleagues' writes
 * arrive through mesh `check-now` in well under a second, so the regular
 * reconnect is only a safety net (external DAV edits, peers without a mesh,
 * your own other devices). It then waits longer than the server's `retry`;
 * without a link it waits exactly `retry`.
 *
 * Hysteresis: losing the link counts at once, so the safety net tightens
 * right away. A new link counts only once it has held for `linkedHoldMs`, so a
 * flapping mesh stays on the base interval instead of switching back and forth.
 */
export type MeshRetryOptions = {
  /** Interval with a held link = base × this (3 s → 5 s). */
  linkedFactor: number;
  /** How long a link must hold before the longer interval applies. */
  linkedHoldMs: number;
  now?: () => number;
};

export const DEFAULT_MESH_RETRY: MeshRetryOptions = {
  linkedFactor: 5 / 3,
  linkedHoldMs: 30_000,
};

export class MeshRetryInterval {
  #options: MeshRetryOptions;
  #now: () => number;
  /** When the current link began, or null while there is none. */
  #linkedSince: number | null = null;

  constructor(options: Partial<MeshRetryOptions> = {}) {
    this.#options = { ...DEFAULT_MESH_RETRY, ...options };
    this.#now = options.now ?? (() => Date.now());
  }

  /** Report the mesh state; a repeat of the same state changes nothing. */
  setLinked(linked: boolean): void {
    if (!linked) this.#linkedSince = null;
    else this.#linkedSince ??= this.#now();
  }

  /** True once the current link has held for `linkedHoldMs`. */
  get linkHeld(): boolean {
    return (
      this.#linkedSince !== null && this.#now() - this.#linkedSince >= this.#options.linkedHoldMs
    );
  }

  /** The visible reconnect delay for the server's `retry` (`baseMs`). */
  delayFor(baseMs: number): number {
    return this.linkHeld ? Math.round(baseMs * this.#options.linkedFactor) : baseMs;
  }
}
