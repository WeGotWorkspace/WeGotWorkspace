import { offlineAccountKeyFromUsername } from "@/lib/offline/core/offline-db";

/**
 * "The upload queue of this account changed" — in this tab and every other
 * tab. BroadcastChannel when available; otherwise a localStorage key bump,
 * which fires `storage` events in the other tabs.
 */

type QueueListener = () => void;

const localListeners = new Map<string, Set<QueueListener>>();
const channels = new Map<string, BroadcastChannel | null>();

function channelName(accountKey: string): string {
  return `wgw-drive-upload-queue:${accountKey}`;
}

function storagePingKey(accountKey: string): string {
  return `wgw.drive-upload-queue.changed.${accountKey}`;
}

function channelFor(accountKey: string): BroadcastChannel | null {
  if (channels.has(accountKey)) return channels.get(accountKey) ?? null;
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(channelName(accountKey));
      channel.addEventListener("message", () => emitLocal(accountKey));
      // Node (tests) keeps the process alive for an open channel; browsers have no `unref`.
      (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    } catch {
      channel = null;
    }
  }
  channels.set(accountKey, channel);
  return channel;
}

function emitLocal(accountKey: string): void {
  for (const listener of localListeners.get(accountKey) ?? []) listener();
}

export function notifyDriveUploadQueueChanged(username: string): void {
  const accountKey = offlineAccountKeyFromUsername(username);
  emitLocal(accountKey);
  const channel = channelFor(accountKey);
  if (channel) {
    channel.postMessage({ type: "changed", at: Date.now() });
    return;
  }
  try {
    window.localStorage.setItem(storagePingKey(accountKey), String(Date.now()));
  } catch {
    // No channel and no storage: other tabs catch up on their next read.
  }
}

/** Listen for queue changes from this tab and from other tabs. */
export function onDriveUploadQueueChanged(username: string, listener: QueueListener): () => void {
  const accountKey = offlineAccountKeyFromUsername(username);
  const set = localListeners.get(accountKey) ?? new Set<QueueListener>();
  localListeners.set(accountKey, set);
  set.add(listener);
  channelFor(accountKey);
  const onStorage = (event: StorageEvent) => {
    if (event.key === storagePingKey(accountKey)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Close channels so a test can simulate another tab. For unit tests only. */
export function resetDriveUploadEventsForTests(): void {
  for (const channel of channels.values()) channel?.close();
  channels.clear();
  localListeners.clear();
}
