import {
  subscribeDriveUploadQueue,
  type DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

type SnapshotListener = (snapshot: DriveUploadQueueSnapshot) => void;

export type DriveUploadQueueWatch = (listener: SnapshotListener) => () => void;

type SharedWatcher = {
  watch: DriveUploadQueueWatch;
  listeners: Set<SnapshotListener>;
  latest: DriveUploadQueueSnapshot | null;
  stop: (() => void) | null;
};

const watchers = new Map<string, SharedWatcher>();

/**
 * One queue subscription per account, shared by every part of the UI that
 * shows uploads (sidebar entry, rings, Uploads view). A new listener gets the
 * last known snapshot right away, then every change. The function is stable
 * per account, so a component can depend on it.
 */
export function sharedDriveUploadQueueWatch(username: string): DriveUploadQueueWatch {
  const key = username.trim().toLowerCase();
  const existing = watchers.get(key);
  if (existing) return existing.watch;
  const shared: SharedWatcher = {
    listeners: new Set(),
    latest: null,
    stop: null,
    watch: (listener) => {
      shared.listeners.add(listener);
      if (shared.latest) listener(shared.latest);
      if (!shared.stop) {
        shared.stop = subscribeDriveUploadQueue(username, (snapshot) => {
          shared.latest = snapshot;
          for (const each of [...shared.listeners]) each(snapshot);
        });
      }
      return () => {
        shared.listeners.delete(listener);
        if (shared.listeners.size > 0 || !shared.stop) return;
        shared.stop();
        shared.stop = null;
      };
    },
  };
  watchers.set(key, shared);
  return shared.watch;
}

/** Forget every shared subscription and snapshot (sign-out, tests). */
export function resetSharedDriveUploadQueueWatches(): void {
  for (const shared of watchers.values()) shared.stop?.();
  watchers.clear();
}
