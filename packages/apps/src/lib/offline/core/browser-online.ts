import { shortenWithJitter } from "@/lib/traffic/jitter";

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

/**
 * Probe reachability while offline with a stale `navigator.onLine` (DevTools service-worker
 * offline, a firewall block). Each failed probe doubles the wait (2 s … 60 s); jitter only
 * shortens it. Tabs share every probe result, so one try serves the whole browser (#2288).
 */
const OFFLINE_PROBE_FIRST_WAIT_MS = 2000;
const OFFLINE_PROBE_MAX_WAIT_MS = 60_000;
const PROBE_CHANNEL_NAME = "wgw-reachability";

type ProbeMessage = { type: typeof PROBE_CHANNEL_NAME; reachable: boolean };

function isProbeMessage(value: unknown): value is ProbeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ProbeMessage).type === PROBE_CHANNEL_NAME &&
    typeof (value as ProbeMessage).reachable === "boolean"
  );
}

/** The wait after `failures` failed probes in a row (before jitter). */
export function offlineProbeWaitMs(failures: number): number {
  const exponent = Math.max(0, failures - 1);
  return Math.min(OFFLINE_PROBE_FIRST_WAIT_MS * 2 ** exponent, OFFLINE_PROBE_MAX_WAIT_MS);
}

type ConnectivityHub = {
  online: boolean;
  subscribers: Set<() => void>;
  started: boolean;
  probeController?: AbortController;
  offlinePollId?: number;
  deferredId?: number;
  /** Failed probes in a row, from this tab or another tab of this browser. */
  failures: number;
  channel?: BroadcastChannel | null;
};

function getConnectivityHub(): ConnectivityHub | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { __wgwConnectivityHub?: ConnectivityHub };
  if (!w.__wgwConnectivityHub) {
    w.__wgwConnectivityHub = {
      online: readBrowserOnline(),
      subscribers: new Set(),
      started: false,
      failures: 0,
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
  window.clearTimeout(hub.offlinePollId);
  hub.offlinePollId = undefined;
}

function shareProbeResult(hub: ConnectivityHub, reachable: boolean): void {
  const message: ProbeMessage = { type: PROBE_CHANNEL_NAME, reachable };
  try {
    hub.channel?.postMessage(message);
  } catch {
    // Channel closed (hub reset): nobody to tell.
  }
}

/** Wait (shortened by jitter) after the latest failure, then probe again. */
function armNextProbe(hub: ConnectivityHub): void {
  clearOfflinePoll(hub);
  if (hub.online || !readBrowserOnline()) return;
  hub.offlinePollId = window.setTimeout(
    () => {
      hub.offlinePollId = undefined;
      if (hub.online || !readBrowserOnline()) return;
      scheduleReachabilityProbe(hub);
    },
    shortenWithJitter(offlineProbeWaitMs(hub.failures)),
  );
}

function scheduleReachabilityProbe(hub: ConnectivityHub): void {
  hub.probeController?.abort();
  clearOfflinePoll(hub);
  if (!readBrowserOnline()) {
    return;
  }
  hub.probeController = new AbortController();
  const { signal } = hub.probeController;
  void probeBrowserReachable(signal).then((reachable) => {
    if (signal.aborted) return;
    shareProbeResult(hub, reachable);
    if (!reachable) {
      hub.failures += 1;
      setConnectivityOnline(hub, false);
      armNextProbe(hub);
      return;
    }
    hub.failures = 0;
    if (readBrowserOnline()) {
      setConnectivityOnline(hub, true);
    }
  });
}

/** Another tab probed: a failure counts as our attempt, a success brings us online. */
function onSharedProbeResult(hub: ConnectivityHub, reachable: boolean): void {
  if (!readBrowserOnline()) return;
  if (reachable) {
    if (hub.online) return;
    hub.probeController?.abort();
    hub.failures = 0;
    setConnectivityOnline(hub, true);
    return;
  }
  if (hub.online) return;
  hub.probeController?.abort();
  hub.failures += 1;
  armNextProbe(hub);
}

function setConnectivityOnline(hub: ConnectivityHub, online: boolean): void {
  if (hub.online === online) return;
  hub.online = online;
  if (online) {
    clearOfflinePoll(hub);
  }
  notifyConnectivitySubscribers(hub);
}

function ensureConnectivityHubStarted(hub: ConnectivityHub): void {
  if (hub.started) return;
  hub.started = true;

  const onOnline = () => {
    hub.probeController?.abort();
    clearOfflinePoll(hub);
    hub.failures = 0;
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

  hub.channel =
    typeof BroadcastChannel === "function" ? new BroadcastChannel(PROBE_CHANNEL_NAME) : null;
  if (hub.channel) {
    hub.channel.onmessage = (event: MessageEvent) => {
      if (isProbeMessage(event.data)) onSharedProbeResult(hub, event.data.reachable);
    };
  }

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
  w.__wgwConnectivityHub?.probeController?.abort();
  w.__wgwConnectivityHub?.channel?.close();
  if (w.__wgwConnectivityHub) clearOfflinePoll(w.__wgwConnectivityHub);
  delete w.__wgwConnectivityHub;
}
