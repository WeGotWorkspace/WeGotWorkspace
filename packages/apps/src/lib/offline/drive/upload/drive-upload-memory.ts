/**
 * Files that had no room on the device stay in the memory of the tab that
 * queued them. Only that tab can upload them. Another tab that holds the
 * uploader lock asks over a BroadcastChannel whether the owner is still open;
 * when nobody answers, the bytes are gone (`no_local_copy`).
 */

const PROBE_CHANNEL = "wgw-drive-upload-memory";
export const MEMORY_PROBE_TIMEOUT_MS = 750;

type ProbeMessage =
  | { type: "probe"; itemId: string; nonce: string }
  | { type: "held"; itemId: string; nonce: string };

const files = new Map<string, File>();
let tabId = `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
let responder: BroadcastChannel | null = null;

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    const channel = new BroadcastChannel(PROBE_CHANNEL);
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    return channel;
  } catch {
    return null;
  }
}

function ensureResponder(): void {
  if (responder) return;
  responder = openChannel();
  responder?.addEventListener("message", (event: MessageEvent<ProbeMessage>) => {
    const message = event.data;
    if (message?.type !== "probe" || !files.has(message.itemId)) return;
    responder?.postMessage({ type: "held", itemId: message.itemId, nonce: message.nonce });
  });
}

/** This tab's id, stored on items whose bytes live only here. */
export function uploadMemoryTabId(): string {
  return tabId;
}

export function keepUploadInMemory(itemId: string, file: File): void {
  files.set(itemId, file);
  ensureResponder();
}

export function uploadFromMemory(itemId: string): File | undefined {
  return files.get(itemId);
}

export function forgetUploadInMemory(itemId: string): void {
  files.delete(itemId);
}

/** True when another open tab still holds this item's bytes. */
export function isUploadHeldByAnotherTab(itemId: string): Promise<boolean> {
  const channel = openChannel();
  if (!channel) return Promise.resolve(false);
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const finish = (held: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(held);
    };
    const timer = setTimeout(() => finish(false), MEMORY_PROBE_TIMEOUT_MS);
    channel.addEventListener("message", (event: MessageEvent<ProbeMessage>) => {
      const message = event.data;
      if (message?.type === "held" && message.itemId === itemId && message.nonce === nonce) {
        finish(true);
      }
    });
    channel.postMessage({ type: "probe", itemId, nonce } satisfies ProbeMessage);
  });
}

/** Forget every file and take a new tab id, as after a reload. For unit tests only. */
export function simulateUploadMemoryReloadForTests(): void {
  files.clear();
  responder?.close();
  responder = null;
  tabId = `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
