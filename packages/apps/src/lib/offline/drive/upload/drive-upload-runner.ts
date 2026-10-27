import { DriveTransportError, driveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";
import { withCrossTabLock, type WithCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { JmapRequestError } from "@/lib/jmap-client";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import { onDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { completeDriveUpload } from "@/lib/offline/drive/upload/drive-upload-handoff";
import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";
import {
  forgetUploadInMemory,
  isUploadHeldByAnotherTab,
  uploadFromMemory,
  uploadMemoryTabId,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import type { OfflineDriveUploadItemRow } from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  failDriveUpload,
  listStartableDriveUploads,
  markDriveUploadStarted,
  readDriveUploadBatch,
  readDriveUploadBlob,
  recordDriveUploadCreated,
  requeueDriveUpload,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  DriveUploadTooLargeError,
  transferDriveUpload,
} from "@/lib/offline/drive/upload/drive-upload-transfer";

/** Wait before trying again after a server hiccup or a failed token renewal. */
export const DRIVE_UPLOAD_RETRY_DELAY_MS = 30_000;

type UploadOutcome = "next" | "stop" | "retry_later";

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
  private idleWaiters: Array<() => void> = [];
  private readonly cleanups: Array<() => void> = [];

  constructor(
    readonly username: string,
    options: DriveUploaderOptions = {},
  ) {
    this.lock = options.lock ?? withCrossTabLock;
    this.cleanups.push(onDriveUploadQueueChanged(username, () => this.wake()));
    if (typeof window !== "undefined") {
      const onOnline = () => this.wake();
      window.addEventListener("online", onOnline);
      this.cleanups.push(() => window.removeEventListener("online", onOnline));
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
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    await this.running;
    this.resolveIdle();
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private async cycle(): Promise<void> {
    if (!readBrowserOnline()) return;
    if ((await listStartableDriveUploads(this.username)).length === 0) return;
    await this.lock(driveUploaderLockName(this.username), ({ signal }) => this.drain(signal), {
      signal: this.stopController.signal,
    });
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
      if (outcome === "retry_later") {
        this.scheduleRetry();
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
        code: item.localCopy ? "upload_failed" : "no_local_copy",
        message: "The stored file is missing. Add it again.",
      });
      return "next";
    }
    if (!(await markDriveUploadStarted(this.username, item.id))) return "next";
    try {
      const session = await driveJmapSession();
      const result = await transferDriveUpload(
        session,
        {
          folderId: item.targetFolder.id,
          name: item.name,
          mimeType: item.mimeType,
          blob,
          ...(item.createdNodeId ? { createdNodeId: item.createdNodeId } : {}),
          onCreated: (nodeId) => recordDriveUploadCreated(this.username, item.id, nodeId),
        },
        signal,
      );
      const batch = await readDriveUploadBatch(this.username, item.batchId);
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
    if (isTooLarge(error)) {
      const message =
        error instanceof Error ? error.message : "The file is too large for this server.";
      await failDriveUpload(this.username, item.id, { code: "too_large", message });
      return "next";
    }
    if (signal.aborted || !readBrowserOnline()) {
      // Lost the lock, stopped, or went offline: the `online` event resumes.
      await requeueDriveUpload(this.username, item.id, { countFailure: false });
      return "stop";
    }
    // The item waits in every tab, not just this one, before it is tried again.
    const retryAt = Date.now() + DRIVE_UPLOAD_RETRY_DELAY_MS;
    if (isNetworkFailure(error)) {
      // The browser says online but the request never arrived: try again later.
      await requeueDriveUpload(this.username, item.id, { countFailure: false, retryAt });
      return "retry_later";
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isTransientFailure(error)) {
      await requeueDriveUpload(this.username, item.id, { countFailure: true, message, retryAt });
      return "retry_later";
    }
    await failDriveUpload(this.username, item.id, { code: "upload_failed", message });
    return "next";
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.wake();
    }, DRIVE_UPLOAD_RETRY_DELAY_MS);
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

function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof DriveTransportError) return error.status;
  if (error instanceof JmapRequestError) return error.status;
  return undefined;
}

function isTooLarge(error: unknown): boolean {
  return error instanceof DriveUploadTooLargeError || httpStatusOf(error) === 413;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return isFetchNetworkError(error);
}

function isTransientFailure(error: unknown): boolean {
  if (error instanceof WgwSessionRenewalError) return true;
  const status = httpStatusOf(error);
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
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
