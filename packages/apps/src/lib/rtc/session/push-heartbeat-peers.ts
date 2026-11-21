import type { SignalingChannel } from "@/lib/rtc/types";

/**
 * This browser's live signaling peers, named on every push read so the read
 * keeps them alive (`X-WGW-Rtc-Peers`, #2287). Behind the push doorbell a quiet
 * room does not poll; only the tab that holds the push stream sends, so every tab
 * publishes its peers under its own `localStorage` key and the stream tab reads
 * them all. A tab rewrites its entry every `WRITE_EVERY_MS` while it has peers;
 * an entry older than `ENTRY_TTL_MS` (a crashed tab) is dropped, so a peer
 * nobody holds any more expires on the server as before. The server refreshes a
 * named peer at most every 30 s, after re-checking the room's access.
 */
export const RTC_PUSH_PEERS_HEADER = "X-WGW-Rtc-Peers";

const KEY_PREFIX = "wgw.rtc.pushPeers.";
const WRITE_EVERY_MS = 20_000;
const ENTRY_TTL_MS = 45_000;
/** The server reads at most 32 (`RtcPushHeartbeat::MAX_PEERS`). */
const MAX_PEERS = 32;

type Entry = { at: number; peers: string[] };

export type PushHeartbeatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
  readonly length: number;
};

type Registry = {
  tabKey: string;
  peers: Map<string, number>;
  timer: ReturnType<typeof setInterval> | null;
  storage: () => PushHeartbeatStorage | null;
  now: () => number;
};

function browserStorage(): PushHeartbeatStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function randomKey(): string {
  return Math.random().toString(36).slice(2, 12);
}

let registry: Registry = createRegistry();

function createRegistry(
  storage: () => PushHeartbeatStorage | null = browserStorage,
  now: () => number = Date.now,
): Registry {
  return { tabKey: KEY_PREFIX + randomKey(), peers: new Map(), timer: null, storage, now };
}

/** Channels whose peer tables the server refreshes on a push read. */
const HEARTBEAT_CHANNELS: ReadonlySet<SignalingChannel> = new Set(["collab", "principal", "meet"]);

/** Whether a push read can keep this channel's peers alive. */
export function pushHeartbeatCovers(channel: SignalingChannel): boolean {
  return HEARTBEAT_CHANNELS.has(channel);
}

function entryOf(channel: SignalingChannel, peerId: string): string {
  return `${channel}:${peerId}`;
}

function publish(): void {
  const storage = registry.storage();
  if (!storage) return;
  try {
    if (registry.peers.size === 0) {
      storage.removeItem(registry.tabKey);
      return;
    }
    const entry: Entry = { at: registry.now(), peers: [...registry.peers.keys()] };
    storage.setItem(registry.tabKey, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: this tab's own peers still go out when it holds the stream.
  }
}

function syncTimer(): void {
  if (registry.peers.size > 0 && registry.timer === null) {
    registry.timer = setInterval(publish, WRITE_EVERY_MS);
    if (typeof window !== "undefined") window.addEventListener("pagehide", clearOnPageHide);
  } else if (registry.peers.size === 0 && registry.timer !== null) {
    clearInterval(registry.timer);
    registry.timer = null;
    if (typeof window !== "undefined") window.removeEventListener("pagehide", clearOnPageHide);
  }
}

function clearOnPageHide(): void {
  try {
    registry.storage()?.removeItem(registry.tabKey);
  } catch {
    // Nothing to clean up without storage.
  }
}

/**
 * Names a peer this tab holds; returns the release. Channels the server does not
 * refresh this way register nothing, so their rooms keep their own heartbeat poll. The same peer may be
 * registered twice (a rejoin racing a leave); it stays until both release.
 */
export function registerPushHeartbeatPeer(channel: SignalingChannel, peerId: string): () => void {
  if (!HEARTBEAT_CHANNELS.has(channel)) return () => undefined;
  const key = entryOf(channel, peerId);
  registry.peers.set(key, (registry.peers.get(key) ?? 0) + 1);
  publish();
  syncTimer();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (registry.peers.get(key) ?? 1) - 1;
    if (count > 0) registry.peers.set(key, count);
    else registry.peers.delete(key);
    publish();
    syncTimer();
  };
}

/**
 * Every tab's live peers in one order, capped at what the server reads. Sorted,
 * so each tab cuts the same set and agrees on which peers a push read covers.
 * An entry past its TTL (a crashed tab that never fired pagehide) is removed.
 */
function namedPeers(): string[] {
  const all = new Set(registry.peers.keys());
  const storage = registry.storage();
  if (storage) {
    try {
      const cutoff = registry.now() - ENTRY_TTL_MS;
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(KEY_PREFIX) && key !== registry.tabKey) keys.push(key);
      }
      for (const key of keys) {
        const entry = parseEntry(storage.getItem(key));
        if (!entry || entry.at < cutoff) {
          storage.removeItem(key);
          continue;
        }
        for (const peer of entry.peers) all.add(peer);
      }
    } catch {
      // Only this tab's peers.
    }
  }
  return [...all].sort().slice(0, MAX_PEERS);
}

/** The header value for a push read: every tab's live peers, or null when there are none. */
export function pushHeartbeatHeaderValue(): string | null {
  const peers = namedPeers();
  return peers.length === 0 ? null : peers.join(",");
}

/**
 * Whether push reads name this peer. Past the server's cap a peer is left out,
 * and its room must keep its own heartbeat poll.
 */
export function pushHeartbeatIncludes(channel: SignalingChannel, peerId: string): boolean {
  return namedPeers().includes(entryOf(channel, peerId));
}

function parseEntry(raw: string | null): Entry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Entry>;
    if (typeof value.at !== "number" || !Array.isArray(value.peers)) return null;
    return { at: value.at, peers: value.peers.filter((peer) => typeof peer === "string") };
  } catch {
    return null;
  }
}

/** Tests: a fresh registry on the given storage and clock. */
export function resetPushHeartbeatPeersForTests(
  storage?: () => PushHeartbeatStorage | null,
  now?: () => number,
): void {
  if (registry.timer !== null) clearInterval(registry.timer);
  registry = createRegistry(storage, now);
}
