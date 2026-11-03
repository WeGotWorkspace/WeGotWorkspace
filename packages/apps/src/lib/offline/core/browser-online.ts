/** Read the browser's current online flag (SSR-safe). */
export function readBrowserOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/** TypeError texts for a fetch that never reached a server (Chrome, Firefox, React Native, Safari). */
const NETWORK_FAILURE_TEXTS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
];

/** True when a fetch failed because the device/network is unreachable (not HTTP 4xx/5xx). */
export function isFetchNetworkError(error: unknown): boolean {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") return false;
    if (error.name === "NetworkError") return true;
  }
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    // eslint-disable-next-line no-restricted-syntax -- reviewed exception (#1642): no server, no status
    return NETWORK_FAILURE_TEXTS.some((text) => message.includes(text));
  }
  return false;
}

/** Poll reachability while offline with a stale `navigator.onLine` (DevTools service-worker offline). */
const OFFLINE_REACHABILITY_POLL_MS = 2000;

type ConnectivityHub = {
  online: boolean;
  subscribers: Set<() => void>;
  started: boolean;
  probeController?: AbortController;
  offlinePollId?: number;
  deferredId?: number;
};

function getConnectivityHub(): ConnectivityHub | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { __wgwConnectivityHub?: ConnectivityHub };
  if (!w.__wgwConnectivityHub) {
    w.__wgwConnectivityHub = {
      online: readBrowserOnline(),
      subscribers: new Set(),
      started: false,
    };
  }
  return w.__wgwConnectivityHub;
}

function notifyConnectivitySubscribers(hub: ConnectivityHub): void {
  for (const subscriber of hub.subscribers) {
    subscriber();
  }
}

/**
 * Probe same-origin reachability. Catches DevTools "offline before navigation" where
 * `navigator.onLine` stays true until the offline event fires.
 */
export async function probeBrowserReachable(signal?: AbortSignal): Promise<boolean> {
  if (!readBrowserOnline()) {
    return false;
  }
  try {
    await fetch(new URL(import.meta.env.BASE_URL, window.location.origin), {
      method: "HEAD",
      cache: "no-store",
      signal,
    });
    return true;
  } catch (error) {
    return isFetchNetworkError(error) ? false : true;
  }
}

/** Snapshot for useSyncExternalStore; may reflect probe results when navigator.onLine is stale. */
export function getConnectivitySnapshot(): boolean {
  return getConnectivityHub()?.online ?? readBrowserOnline();
}

function clearOfflinePoll(hub: ConnectivityHub): void {
  if (hub.offlinePollId === undefined) return;
  window.clearInterval(hub.offlinePollId);
  hub.offlinePollId = undefined;
}

function scheduleReachabilityProbe(hub: ConnectivityHub): void {
  hub.probeController?.abort();
  if (!readBrowserOnline()) {
    return;
  }
  hub.probeController = new AbortController();
  const { signal } = hub.probeController;
  void probeBrowserReachable(signal).then((reachable) => {
    if (signal.aborted) return;
    if (!reachable) {
      setConnectivityOnline(hub, false);
      return;
    }
    if (readBrowserOnline()) {
      setConnectivityOnline(hub, true);
    }
  });
}

function startOfflinePoll(hub: ConnectivityHub): void {
  if (hub.offlinePollId !== undefined || !readBrowserOnline()) return;
  hub.offlinePollId = window.setInterval(() => {
    if (!readBrowserOnline()) {
      clearOfflinePoll(hub);
      return;
    }
    scheduleReachabilityProbe(hub);
  }, OFFLINE_REACHABILITY_POLL_MS);
}

function setConnectivityOnline(hub: ConnectivityHub, online: boolean): void {
  if (hub.online === online) return;
  hub.online = online;
  if (online) {
    clearOfflinePoll(hub);
  } else if (readBrowserOnline()) {
    startOfflinePoll(hub);
  }
  notifyConnectivitySubscribers(hub);
}

function ensureConnectivityHubStarted(hub: ConnectivityHub): void {
  if (hub.started) return;
  hub.started = true;

  const onOnline = () => {
    hub.probeController?.abort();
    clearOfflinePoll(hub);
    scheduleReachabilityProbe(hub);
  };
  const onOffline = () => {
    hub.probeController?.abort();
    setConnectivityOnline(hub, false);
  };
  const onFocus = () => {
    if (hub.online) return;
    scheduleReachabilityProbe(hub);
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("focus", onFocus);

  hub.online = readBrowserOnline();
  notifyConnectivitySubscribers(hub);
  hub.deferredId = window.setTimeout(() => {
    if (!readBrowserOnline()) {
      setConnectivityOnline(hub, false);
    }
  }, 0);
  scheduleReachabilityProbe(hub);
}

/** Subscribe to browser online/offline events. No-op outside the browser. */
export function subscribeBrowserOnline(onStoreChange: () => void): () => void {
  const hub = getConnectivityHub();
  if (!hub) {
    return () => undefined;
  }

  ensureConnectivityHubStarted(hub);
  hub.subscribers.add(onStoreChange);
  onStoreChange();

  return () => {
    hub.subscribers.delete(onStoreChange);
  };
}

/** Clears the shared browser connectivity hub. For unit tests only. */
export function resetConnectivityHubForTests(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __wgwConnectivityHub?: ConnectivityHub };
  delete w.__wgwConnectivityHub;
}
