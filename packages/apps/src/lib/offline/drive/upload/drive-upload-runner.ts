import { driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { withCrossTabLock, type WithCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { onDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { classifyDriveUploadFailure } from "@/lib/offline/drive/upload/drive-upload-failure";
import { completeDriveUpload } from "@/lib/offline/drive/upload/drive-upload-handoff";
import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";
import {
  forgetUploadInMemory,
  isUploadHeldByAnotherTab,
  uploadFromMemory,
  uploadMemoryTabId,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import { migrateDriveOutboxUploads } from "@/lib/offline/drive/upload/drive-upload-outbox-migration";
import type { OfflineDriveUploadItemRow } from "@/lib/offline/drive/upload/drive-upload-schema";
import { serverHasSpaceForDriveUpload } from "@/lib/offline/drive/upload/drive-upload-space-check";
import {
  deferDriveUploadSpaceCheck,
  failDriveUpload,
  listStartableDriveUploads,
  markDriveUploadStarted,
  readDriveUploadBatch,
  readDriveUploadBlob,
  readDriveUploadQueueRows,
  recordDriveUploadCreated,
  requeueDriveUpload,
  resumeDriveUploadQueue,
  saveDriveUploadProgress,
  skipDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { transferDriveUpload } from "@/lib/offline/drive/upload/drive-upload-transfer";

/** Wait before trying again after a network drop, and before the first retry after a hiccup. */
export const DRIVE_UPLOAD_RETRY_DELAY_MS = 30_000;
/** Longest wait between retries after hiccups in a row (the wait doubles each time). */
export const DRIVE_UPLOAD_MAX_RETRY_DELAY_MS = 8 * 60_000;
/** While the server is full: how often the uploader asks `Quota/get` for room. */
export const DRIVE_UPLOAD_SPACE_POLL_MS = 60_000;

/** Backoff after the `failures`-th hiccup in a row: 30 s, 1 min, 2 min, … up to 8 min. */
export function driveUploadRetryDelay(failures: number): number {
  const doubled = DRIVE_UPLOAD_RETRY_DELAY_MS * 2 ** Math.max(0, failures - 1);
  return Math.min(DRIVE_UPLOAD_MAX_RETRY_DELAY_MS, doubled);
}

/** `retryIn`: the item waits in the queue; wake again after that many ms. */
type UploadOutcome = "next" | "stop" | { retryIn: number };

export type DriveUploaderOptions = {
  lock?: WithCrossTabLock;
};

/**
 * One uploader per account and tab. Every tab with queued files asks for the
 * account's uploader lock; the holder drains the queue strictly one file at a
 * time, and the others wait in the lock to take over when it is done or its
 * tab closes. Uploads run only while a tab is open; `startDriveUploader` on
 * app start picks up whatever is left.
 */
export class DriveUploader {
  private readonly lock: WithCrossTabLock;
  private readonly stopController = new AbortController();
  private active = false;
  private running: Promise<void> = Promise.resolve();
  private dirty = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private spaceTimer: ReturnType<typeof setTimeout> | null = null;
  private outboxMigrated = false;
  private idleWaiters: Array<() => void> = [];
  private readonly cleanups: Array<() => void> = [];

  constructor(
    readonly username: string,
    options: DriveUploaderOptions = {},
  ) {
    this.lock = options.lock ?? withCrossTabLock;
    this.cleanups.push(onDriveUploadQueueChanged(username, () => this.wake()));
    if (typeof window !== "undefined") {
      const onWakeEvent = () => this.wake();
      window.addEventListener("online", onWakeEvent);
      this.cleanups.push(() => window.removeEventListener("online", onWakeEvent));
      // A page restored from the back-forward cache does not remount, and its
      // fallback lock was released on `pagehide`, so it must wake itself.
      window.addEventListener("pageshow", onWakeEvent);
      this.cleanups.push(() => window.removeEventListener("pageshow", onWakeEvent));
    }
  }

  wake(): void {
    if (this.stopController.signal.aborted) return;
    if (this.active) {
      this.dirty = true;
      return;
    }
    this.active = true;
    this.running = this.cycle()
      .catch((error: unknown) => console.warn("[drive-upload] uploader cycle failed", error))
      .finally(() => {
        this.active = false;
        if (this.dirty && !this.stopController.signal.aborted) {
          this.dirty = false;
          this.wake();
          return;
        }
        this.resolveIdle();
      });
  }

  /** Resolves once the uploader has nothing left to do. For tests and diagnostics. */
  whenIdle(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Settles once the cycle in flight has made its last IndexedDB write. */
  async stop(): Promise<void> {
    this.stopController.abort();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.spaceTimer) clearTimeout(this.spaceTimer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    await this.running;
    this.resolveIdle();
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private async cycle(): Promise<void> {
    await this.migrateOutboxOnce();
    if (!readBrowserOnline()) return;
    if (await this.waitForServerSpace()) return;
    if ((await listStartableDriveUploads(this.username)).length === 0) return;
    await this.lock(driveUploaderLockName(this.username), ({ signal }) => this.drain(signal), {
      signal: this.stopController.signal,
    });
  }

  /**
   * Files a previous version left in the outbox as base64 move into the queue
   * once per tab and app start (again later while their folder is unknown).
   */
  private async migrateOutboxOnce(): Promise<void> {
    if (this.outboxMigrated) return;
    try {
      const { waiting } = await migrateDriveOutboxUploads(this.username);
      this.outboxMigrated = waiting === 0;
    } catch (error) {
      console.warn("[drive-upload] outbox migration failed", error);
    }
  }

  /**
   * `paused_server_full`: an item hit a full server, so nothing starts. Once
   * its time has come, ask `Quota/get` whether its target root has room for
   * the rest of it; if so, resume the queue, else ask again later. True while
   * the queue stays paused.
   */
  private async waitForServerSpace(): Promise<boolean> {
    const rows = await readDriveUploadQueueRows(this.username);
    const waiting = rows.items.find(
      (item) => item.status === "failed" && item.error?.code === "server_full",
    );
    if (!waiting) return false;
    const due = waiting.retryAt ?? 0;
    if (due > Date.now()) {
      this.scheduleSpaceCheck(due - Date.now());
      return true;
    }
    const folderPath = rows.folderPaths?.get(waiting.id);
    if (await serverHasSpaceForDriveUpload(this.username, waiting, folderPath)) {
      await resumeDriveUploadQueue(this.username);
      return false;
    }
    await deferDriveUploadSpaceCheck(
      this.username,
      waiting.id,
      Date.now() + DRIVE_UPLOAD_SPACE_POLL_MS,
    );
    return true;
  }

  private scheduleSpaceCheck(delay: number): void {
    if (this.spaceTimer) clearTimeout(this.spaceTimer);
    this.spaceTimer = setTimeout(() => {
      this.spaceTimer = null;
      this.wake();
    }, delay);
  }

  private async drain(lockSignal: AbortSignal): Promise<void> {
    const skipped = new Set<string>();
    // Losing the lock or stopping (sign-out) aborts the request in flight.
    const signal = eitherSignal(lockSignal, this.stopController.signal);
    for (;;) {
      if (signal.aborted) return;
      if (!readBrowserOnline()) return;
      const next = await this.pickNext(skipped);
      if (!next) return;
      const outcome = await this.uploadOne(next, signal);
      if (outcome === "stop") return;
      if (typeof outcome === "object") {
        this.scheduleRetry(outcome.retryIn);
        return;
      }
    }
  }

  /** Oldest startable item this tab can upload. Direct uploads need their tab. */
  private async pickNext(skipped: Set<string>): Promise<OfflineDriveUploadItemRow | null> {
    for (const item of await listStartableDriveUploads(this.username)) {
      if (skipped.has(item.id)) continue;
      if (item.localCopy) return item;
      if (item.memoryOwner === uploadMemoryTabId() && uploadFromMemory(item.id)) return item;
      if (item.memoryOwner !== uploadMemoryTabId() && (await isUploadHeldByAnotherTab(item.id))) {
        skipped.add(item.id);
        continue;
      }
      await failDriveUpload(this.username, item.id, {
        code: "no_local_copy",
        message: "This file was not stored on the device. Add it again.",
      });
    }
    return null;
  }

  private async uploadOne(
    item: OfflineDriveUploadItemRow,
    signal: AbortSignal,
  ): Promise<UploadOutcome> {
    const blob = item.localCopy
      ? await readDriveUploadBlob(this.username, item.id)
      : (uploadFromMemory(item.id) ?? null);
    if (!blob) {
      await failDriveUpload(this.username, item.id, {
        code: item.localCopy ? "permanent" : "no_local_copy",
        message: "The stored file is missing. Add it again.",
      });
      return "next";
    }
    if (!(await markDriveUploadStarted(this.username, item.id))) return "next";
    try {
      const session = await driveJmapSession();
      const batch = await readDriveUploadBatch(this.username, item.batchId);
      const result = await transferDriveUpload(
        session,
        {
          username: this.username,
          folderId: item.targetFolder.id,
          name: item.name,
          mimeType: item.mimeType,
          blob,
          ...(batch?.conflict ? { conflict: batch.conflict } : {}),
          ...(item.replaceTarget ? { replaceTarget: item.replaceTarget } : {}),
          ...(item.chunk ? { chunk: item.chunk } : {}),
          ...(item.createdNodeId ? { createdNodeId: item.createdNodeId } : {}),
          onCreated: (nodeId, notice) =>
            recordDriveUploadCreated(this.username, item.id, nodeId, notice),
          onProgress: (update) =>
            saveDriveUploadProgress(this.username, item.id, {
              chunk: update.state,
              bytesDone: update.bytesDone,
              ...(update.phase ? { phase: update.phase } : {}),
              ...(update.assembledBytes !== undefined
                ? { assembledBytes: update.assembledBytes }
                : {}),
            }),
        },
        signal,
      );
      if (result.kind === "skipped") {
        await skipDriveUploadItem(this.username, item.id);
        return "next";
      }
      await completeDriveUpload(this.username, {
        item,
        keepOffline: batch?.keepOffline ?? "remove",
        node: result.node,
        finalName: result.finalName,
        blob: item.localCopy ? blob : null,
      });
      forgetUploadInMemory(item.id);
      return "next";
    } catch (error) {
      return this.handleFailure(item, error, signal);
    }
  }

  private async handleFailure(
    item: OfflineDriveUploadItemRow,
    error: unknown,
    signal: AbortSignal,
  ): Promise<UploadOutcome> {
    const failure = classifyDriveUploadFailure(error);
    // A reason of its own (too large, server full, access, folder gone, https
    // needed) stands even when the lock was lost meanwhile. None of them is
    // retried with backoff; a full server pauses the whole queue.
    if (failure.kind === "fail" && failure.error.code !== "permanent") {
      const serverFull = failure.error.code === "server_full";
      await failDriveUpload(this.username, item.id, failure.error, {
        keepProgress: failure.keepProgress,
        ...(serverFull ? { checkSpaceAt: Date.now() + DRIVE_UPLOAD_SPACE_POLL_MS } : {}),
      });
      return "next";
    }
    if (signal.aborted || !readBrowserOnline()) {
      // Lost the lock, stopped, or went offline: the `online` or `pageshow` event resumes.
      await requeueDriveUpload(this.username, item.id, { countFailure: false });
      return "stop";
    }
    // The item waits in every tab, not just this one, before it is tried again.
    if (failure.kind === "network") {
      // The browser says online but the request never arrived: try again later.
      const retryIn = DRIVE_UPLOAD_RETRY_DELAY_MS;
      await requeueDriveUpload(this.username, item.id, {
        countFailure: false,
        retryAt: Date.now() + retryIn,
      });
      return { retryIn };
    }
    if (failure.kind === "transient") {
      // Backoff: the wait doubles with every hiccup in a row.
      const retryIn = driveUploadRetryDelay(item.transientFailures + 1);
      await requeueDriveUpload(this.username, item.id, {
        countFailure: true,
        message: failure.message,
        retryAt: Date.now() + retryIn,
      });
      return { retryIn };
    }
    await failDriveUpload(this.username, item.id, failure.error);
    return "next";
  }

  private scheduleRetry(delay: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.wake();
    }, delay);
  }
}

function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

const uploaders = new Map<string, DriveUploader>();

/** Start (or wake) this tab's uploader for the account. Safe to call repeatedly. */
export function startDriveUploader(
  username: string,
  options?: DriveUploaderOptions,
): DriveUploader {
  const key = username.trim().toLowerCase();
  let uploader = uploaders.get(key);
  if (!uploader) {
    uploader = new DriveUploader(username, options);
    uploaders.set(key, uploader);
  }
  uploader.wake();
  return uploader;
}

export async function stopAllDriveUploaders(): Promise<void> {
  const stopping = [...uploaders.values()].map((uploader) => uploader.stop());
  uploaders.clear();
  await Promise.all(stopping);
}
