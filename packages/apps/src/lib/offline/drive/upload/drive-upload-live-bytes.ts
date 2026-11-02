import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * Octets sent of the file this tab is uploading, while a request is still
 * going. The queue stores progress only per finished part, so a file sent in
 * one request (or a large part on a slow line) looked stuck until it was done.
 * Kept in memory and announced at most a few times a second; the tab that
 * uploads shows it, other tabs keep the stored per-part progress.
 */
const NOTIFY_INTERVAL_MS = 250;

const bytesById = new Map<string, number>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(): void {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const listener of listeners) listener();
  }, NOTIFY_INTERVAL_MS);
}

export function reportDriveUploadBytesSent(itemId: string, bytesSent: number): void {
  if ((bytesById.get(itemId) ?? -1) >= bytesSent) return;
  bytesById.set(itemId, bytesSent);
  notifySoon();
}

export function clearDriveUploadBytesSent(itemId: string): void {
  if (bytesById.delete(itemId)) notifySoon();
}

export function driveUploadBytesSent(itemId: string): number | undefined {
  return bytesById.get(itemId);
}

export function subscribeDriveUploadBytesSent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The snapshot with this tab's live counts: stored progress counts finished
 * parts, the request still going adds what it sent. The same object when
 * nothing is ahead of what is stored.
 */
export function withDriveUploadBytesSent(
  snapshot: DriveUploadQueueSnapshot,
): DriveUploadQueueSnapshot {
  let changed = false;
  const items = snapshot.items.map((item) => {
    const sent = item.status === "uploading" ? bytesById.get(item.id) : undefined;
    if (sent === undefined || sent <= item.bytesDone) return item;
    changed = true;
    return { ...item, bytesDone: Math.min(sent, item.bytesTotal) };
  });
  return changed ? { ...snapshot, items } : snapshot;
}
