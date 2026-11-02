import type { CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";

/**
 * One browser's tabs for tests: `topic()` gives a tab its own
 * `crossTabTopic`. Like the real one, the publishing tab hears its message at
 * once and other tabs a task later (BroadcastChannel is asynchronous).
 * Messages are cloned so tabs never share an object.
 */
export class FakeCrossTabBus<T> {
  #tabs = new Set<Set<(message: T) => void>>();
  sent: T[] = [];

  topic(): CrossTabTopic<T> & { close: () => void } {
    const listeners = new Set<(message: T) => void>();
    this.#tabs.add(listeners);
    return {
      publish: (message, options) => {
        this.sent.push(structuredClone(message));
        if (!options?.otherTabsOnly) for (const listener of [...listeners]) listener(message);
        for (const tab of this.#tabs) {
          if (tab === listeners) continue;
          const copy = structuredClone(message);
          setTimeout(() => {
            for (const listener of [...tab]) listener(copy);
          }, 0);
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => {
        this.#tabs.delete(listeners);
      },
    };
  }
}
