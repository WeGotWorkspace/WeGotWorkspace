import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import type { JmapId } from "../core/types.js";
import type { InboundSyncShare } from "./inbound-sync-share.js";
import { syncIfStale } from "./sync-if-stale.js";

/**
 * How long a tab that does not sync waits for the syncing tab's round after a
 * push it is behind on. After that it pulls for itself, as every tab did
 * before #2252: the syncing tab may have loaded after the change, so it has
 * nothing to pull and says nothing.
 */
export const SHARED_ROUND_WAIT_MS = 5_000;

/**
 * What every inbound JMAP adapter shares: one `/changes` round (`sync`), the
 * push entry point (`syncIfStale`, #1661) and the fallback poll that skips
 * while the tab is hidden. A subclass pulls its own types in `pullChanges`
 * and re-lists everything in `refetchAll` after `cannotCalculateChanges`.
 *
 * With {@link JmapInboundAdapter.shareAcrossTabs} one tab per browser runs the
 * poll and the push rounds; the others read the cache it writes (#2252).
 */
export abstract class JmapInboundAdapter {
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;
  /** The round in flight; the next one starts after it stored its state. */
  #tail: Promise<unknown> = Promise.resolve();
  /** False while another tab of this browser pulls for this app and account. */
  #owner = true;
  #share: InboundSyncShare | undefined;
  /** Cache writes a round started that have not finished yet. */
  #ingests = new Set<Promise<unknown>>();
  /** The cursor the other tabs have, so an idle round tells them nothing. */
  #sharedCursor = "";
  /** True once a cache write failed: this tab's cursor may be ahead of the cache. */
  #cursorHeld = false;
  /** Pushes this tab is behind on, waiting for the syncing tab's round. */
  #roundWaiters = new Set<(heard: boolean) => void>();

  /** The JMAP types this adapter syncs. */
  protected abstract readonly pushTypes: readonly string[];
  protected abstract get jmapClient(): JmapClient;
  abstract get accountId(): JmapId;
  /** Pull `/changes` for every type and forward it inbound; throws on failure. */
  protected abstract pullChanges(): Promise<void>;
  /** Full resync after `cannotCalculateChanges` (the server pruned its change log). */
  protected abstract refetchAll(): Promise<void>;
  protected abstract reportSyncError(error: unknown): void;

  /** Pulls remote changes since the last known states and forwards them inbound. */
  async sync(): Promise<void> {
    await this.#syncOnce();
  }

  /**
   * Push entry point: sync only when a pushed state differs from this
   * adapter's own. Resolves false when the sync failed, so the push hub keeps
   * the old hash and the server sends the type again.
   */
  syncIfStale(states: Record<string, string>, accountId?: JmapId): Promise<boolean> {
    return syncIfStale({
      getState: (type) => this.jmapClient.getState(this.accountId, type),
      accountId: this.accountId,
      types: this.pushTypes,
      states,
      pushedAccountId: accountId,
      // The syncing tab pulls and tells the others, also when it found nothing.
      sync: () => (this.#owner ? this.#syncOnce(true) : this.#afterSharedRound()),
    });
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!this.#owner) return;
      if (this.#pollInFlight) return;
      this.#pollInFlight = true;
      void this.sync().finally(() => {
        this.#pollInFlight = false;
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  /**
   * Sync in one tab per browser. Until this tab holds `share`'s lock it skips
   * its poll and its push rounds: another tab pulls and writes the shared
   * cache, and `onSharedRound` runs after each of its rounds so this tab
   * re-reads that cache. A push this tab is behind on waits for that round;
   * if none comes within {@link SHARED_ROUND_WAIT_MS}, this tab pulls itself.
   * When this tab takes the lock over from another tab it catches up with one
   * round. An explicit `sync()` (the user acted in this tab) always runs.
   *
   * The cursor stays in memory. The syncing tab sends it to the others once
   * the round's cache writes are done (see {@link JmapInboundAdapter.ingesting}),
   * so a tab's cursor is never ahead of the cache: the tab that takes over
   * continues from the last shared round, or from an older cursor of its own
   * and then reads a few changes twice. It never skips one.
   *
   * Returns the function that stops sharing; every tab then syncs again.
   */
  shareAcrossTabs(share: InboundSyncShare, onSharedRound: () => void): () => void {
    this.#share = share;
    this.#owner = false;
    const leave = share.start({
      onOwn: (tookOver) => {
        this.#owner = true;
        // The first tab's cursor is the one its first load just stored.
        if (tookOver) void this.sync();
        else this.#sharedCursor = JSON.stringify(this.#cursor());
        // No tab is left to wait for: the pushes this tab was behind on pull now.
        this.#endRoundWaits(false);
      },
      onLose: () => {
        this.#owner = false;
      },
      onRound: (states) => {
        if (!this.#owner) this.#adoptCursor(states);
        this.#endRoundWaits(true);
        onSharedRound();
      },
    });
    return () => {
      leave();
      this.#share = undefined;
      this.#owner = true;
      this.#endRoundWaits(false);
    };
  }

  /**
   * Register a cache write a round started and did not wait for. The round is
   * shared with the other tabs once every such write has finished, and its
   * cursor only when none of them failed.
   */
  ingesting(work: Promise<unknown>): void {
    this.#ingests.add(work);
    const done = () => this.#ingests.delete(work);
    work.then(done, () => {
      // This change is in no cache: from now on this tab shares no cursor,
      // so the tab that takes over reads the change again.
      this.#cursorHeld = true;
      done();
    });
  }

  #cursor(): Record<string, string> {
    const states: Record<string, string> = {};
    for (const type of this.pushTypes) {
      const state = this.jmapClient.getState(this.accountId, type);
      if (state !== undefined) states[type] = state;
    }
    return states;
  }

  #adoptCursor(states: Record<string, string>): void {
    for (const type of this.pushTypes) {
      const state = states[type];
      if (state !== undefined) this.jmapClient.setState(this.accountId, type, state);
    }
    if (Object.keys(states).length > 0) this.#sharedCursor = JSON.stringify(this.#cursor());
  }

  /** The syncing tab's next round, or this tab's own when none comes in time. */
  #afterSharedRound(): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (heard: boolean) => {
        clearTimeout(timer);
        this.#roundWaiters.delete(done);
        resolve(heard ? true : this.#syncOnce());
      };
      const timer = setTimeout(() => done(false), SHARED_ROUND_WAIT_MS);
      this.#roundWaiters.add(done);
    });
  }

  /** `heard`: the syncing tab's round arrived; otherwise the waiting pushes pull here. */
  #endRoundWaits(heard: boolean): void {
    for (const done of [...this.#roundWaiters]) done(heard);
  }

  /**
   * After a round of the syncing tab: tell the others once its writes are in
   * the cache. A round that found nothing is told only when `always` is set
   * (a push round: other tabs may wait for it).
   */
  #shareRound(always: boolean): void {
    if (!this.#share || !this.#owner) return;
    const states = this.#cursor();
    const cursor = JSON.stringify(states);
    if (!always && cursor === this.#sharedCursor) return;
    this.#sharedCursor = cursor;
    void Promise.allSettled([...this.#ingests]).then(() => {
      if (!this.#share || !this.#owner) return;
      this.#share.publishRound(this.#cursorHeld ? {} : states);
    });
  }

  /**
   * One `/changes` round; true when it succeeded. Rounds run one after the
   * other: each stores its cursor, so a round that started first and ended
   * last would rewind it.
   */
  #syncOnce(forPush = false): Promise<boolean> {
    const round = this.#tail.then(() => this.#syncRound(forPush));
    this.#tail = round.catch(() => undefined);
    return round;
  }

  async #syncRound(forPush: boolean): Promise<boolean> {
    try {
      await this.pullChanges();
      this.#shareRound(forPush);
      return true;
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        const refetched = await this.#refetchAllReported();
        if (refetched) this.#shareRound(forPush);
        return refetched;
      }
      this.reportSyncError(error);
      return false;
    }
  }

  /** The full re-list can fail too (#1792: `requestTooLarge` above 500 records). */
  async #refetchAllReported(): Promise<boolean> {
    try {
      await this.refetchAll();
      return true;
    } catch (error) {
      this.reportSyncError(error);
      return false;
    }
  }
}
