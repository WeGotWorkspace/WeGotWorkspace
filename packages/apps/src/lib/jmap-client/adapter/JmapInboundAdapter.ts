import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import type { JmapId } from "../core/types.js";
import { syncIfStale } from "./sync-if-stale.js";

/**
 * What every inbound JMAP adapter shares: one `/changes` round (`sync`), the
 * push entry point (`syncIfStale`, #1661) and the fallback poll that skips
 * while the tab is hidden. A subclass pulls its own types in `pullChanges`
 * and re-lists everything in `refetchAll` after `cannotCalculateChanges`.
 */
export abstract class JmapInboundAdapter {
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;

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
      sync: () => this.#syncOnce(),
    });
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
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

  /** One `/changes` round; true when it succeeded. */
  async #syncOnce(): Promise<boolean> {
    try {
      await this.pullChanges();
      return true;
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        await this.refetchAll();
        return true;
      }
      this.reportSyncError(error);
      return false;
    }
  }
}
