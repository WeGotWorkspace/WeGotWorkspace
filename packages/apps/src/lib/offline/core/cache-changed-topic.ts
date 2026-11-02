import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

type CacheChanged = { type: string; username: string };

export type CacheChangedTopic = {
  /** Tell the other tabs that the shared cache changed. This tab already shows it. */
  notifyOtherTabs: (username: string) => void;
  /** Hear another tab's change for the same offline account. */
  subscribe: (username: string, onChange: () => void) => () => void;
};

/**
 * Every tab of this browser shares one offline cache per app, but each tab
 * only repaints when it changed the cache itself. A tab that writes the cache
 * (an inbound pull, a flush, a refresh) tells the others here, so they re-read
 * it instead of waiting for a change of their own.
 */
export function cacheChangedTopic(domain: string): CacheChangedTopic {
  const type = `${domain}-bootstrap-updated`;
  const topic = crossTabTopic(
    `wgw.${domain}.bootstrap`,
    (value): value is CacheChanged =>
      (value as CacheChanged | null)?.type === type &&
      typeof (value as CacheChanged).username === "string",
  );
  return {
    notifyOtherTabs(username) {
      if (!username) return;
      topic.publish({ type, username }, { otherTabsOnly: true });
    },
    subscribe(username, onChange) {
      if (!username) return () => undefined;
      return topic.subscribe((message) => {
        if (message.username === username) onChange();
      });
    },
  };
}
