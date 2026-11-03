import type { JmapId, JmapState } from "../core/types.js";

export type SyncIfStaleInput = {
  /** The adapter's own state per type (`JmapClient.getState`). */
  getState: (type: string) => JmapState | undefined;
  accountId: JmapId;
  /** The types this adapter syncs. */
  types: readonly string[];
  /** Pushed states (a JMAP StateChange for one account). */
  states: Record<string, string>;
  /** The account the push was for; another account's push is not this adapter's. */
  pushedAccountId?: JmapId;
  /** One `/changes` round; true when it succeeded. */
  sync: () => Promise<boolean>;
};

/**
 * Push entry point for the JMAP adapters (#1661): call `sync()` only when a
 * pushed state differs from the adapter's own, and say whether the adapter is
 * now up to date. False keeps the hub's old hash, so the server sends the type
 * again. A type the adapter has no state for yet is not confirmed: its first
 * load has not landed, and the next push asks again.
 */
export async function syncIfStale(input: SyncIfStaleInput): Promise<boolean> {
  if (input.pushedAccountId !== undefined && input.pushedAccountId !== input.accountId) return true;
  let stale = false;
  let unknown = false;
  for (const type of input.types) {
    const pushed = input.states[type];
    if (pushed === undefined) continue;
    const own = input.getState(type);
    if (own === undefined) unknown = true;
    else if (own !== pushed) stale = true;
  }
  if (!stale) return !unknown;
  try {
    return (await input.sync()) && !unknown;
  } catch {
    return false;
  }
}
