import type { CrossTabLockEnv } from "@/lib/cross-tab/cross-tab-lock";

/**
 * In-memory stand-ins for what several tabs of one origin share: one
 * localStorage and one BroadcastChannel bus. For unit tests only.
 */
export type SimulatedOrigin = {
  storage: Map<string, string>;
  tab: (tabId: string, options?: { locks?: LockManager | null }) => CrossTabLockEnv;
  /** Fire every `pagehide` listener of one tab, as when it closes. */
  closeTab: (tabId: string) => void;
};

type Listener = (event: MessageEvent) => void;

export function simulateOrigin(): SimulatedOrigin {
  const storage = new Map<string, string>();
  const listenersByChannel = new Map<string, Set<Listener>>();
  const pageHide = new Map<string, Set<() => void>>();

  const createChannel = (name: string) => {
    const own = new Set<Listener>();
    const shared = listenersByChannel.get(name) ?? new Set<Listener>();
    listenersByChannel.set(name, shared);
    return {
      postMessage(message: unknown) {
        for (const listener of shared) {
          if (own.has(listener)) continue;
          queueMicrotask(() => listener({ data: message } as MessageEvent));
        }
      },
      addEventListener(_type: "message", listener: Listener) {
        own.add(listener);
        shared.add(listener);
      },
      removeEventListener(_type: "message", listener: Listener) {
        own.delete(listener);
        shared.delete(listener);
      },
      close() {
        for (const listener of own) shared.delete(listener);
        own.clear();
      },
    };
  };

  return {
    storage,
    tab: (tabId, options) => ({
      locks: () => options?.locks ?? null,
      storage: () => ({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      }),
      createChannel,
      tabId,
      now: () => Date.now(),
      addPageHideListener: (listener) => {
        const set = pageHide.get(tabId) ?? new Set<() => void>();
        pageHide.set(tabId, set);
        set.add(listener);
        return () => set.delete(listener);
      },
    }),
    closeTab: (tabId) => {
      for (const listener of pageHide.get(tabId) ?? []) listener();
    },
  };
}
