import { encodePushEventId, type PushHashes } from "./push-event-id";

/** What one tab subscribes to and which hash each of those types last confirmed. */
export type TabConfirmations = {
  types: string[];
  confirmed: PushHashes;
};

/**
 * The confirmed-hash map every tab keeps (docs/architecture/jmap-push.md,
 * "The id is built from confirmed hashes"). The leader rebuilds
 * `Last-Event-ID` from it on every reconnect; a new leader starts from its own
 * copy. No pending list and no retry timer: a type whose sync failed somewhere
 * is left out, so the server sends it again.
 */
export class PushConfirmations {
  /** Hashes from the newest id the server sent, for types nobody subscribes to. */
  #latest: PushHashes = {};
  #tabs = new Map<string, TabConfirmations>();

  noteLatest(hashes: PushHashes): void {
    this.#latest = { ...this.#latest, ...hashes };
  }

  setTab(tabId: string, tab: TabConfirmations): void {
    this.#tabs.set(tabId, { types: [...tab.types], confirmed: { ...tab.confirmed } });
  }

  removeTab(tabId: string): void {
    this.#tabs.delete(tabId);
  }

  /** Forget every tab but one: a hub that was stopped missed their updates. */
  keepOnly(tabId: string): void {
    for (const id of [...this.#tabs.keys()]) if (id !== tabId) this.#tabs.delete(id);
  }

  /**
   * Per type: the hash every live subscribed tab confirmed, or the newest hash
   * when no live tab subscribes (that app syncs when it opens). A type the
   * tabs disagree on, or one a subscribed tab has not confirmed, is left out.
   * `liveTabIds` null means every known tab counts as live. A live tab with no
   * entry may hold a failed sync this tab never heard of, so no id is sent and
   * the server re-sends every type.
   */
  lastEventId(liveTabIds: ReadonlySet<string> | null): string | null {
    if (liveTabIds) for (const tabId of liveTabIds) if (!this.#tabs.has(tabId)) return null;
    const tabs = [...this.#tabs]
      .filter(([tabId]) => liveTabIds === null || liveTabIds.has(tabId))
      .map(([, tab]) => tab);
    const types = new Set(Object.keys(this.#latest));
    for (const tab of tabs) for (const type of Object.keys(tab.confirmed)) types.add(type);

    const hashes: PushHashes = {};
    for (const type of types) {
      const subscribers = tabs.filter((tab) => tab.types.includes(type));
      if (subscribers.length === 0) {
        const latest = this.#latest[type];
        if (latest) hashes[type] = latest;
        continue;
      }
      const first = subscribers[0]!.confirmed[type];
      if (first && subscribers.every((tab) => tab.confirmed[type] === first)) {
        hashes[type] = first;
      }
    }
    return encodePushEventId(hashes);
  }
}
