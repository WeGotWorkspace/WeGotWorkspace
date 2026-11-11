import { useEffect, useRef } from "react";
import type { DriveUploadQueueModel } from "@/drive-core/src/drive-upload-queue";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { takeDriveUploadRetryAfterSignIn } from "@/drive-core/src/drive-upload-sign-in";

/**
 * Back from the sign-in that *Retry* on an `auth` file started (#1522):
 * the `auth` files (or, after *Retry all failed*, every failed file) go
 * back to the queue once, on the first queue snapshot.
 */
export function useDriveUploadRetryAfterSignIn(
  model: DriveUploadQueueModel | null,
  operations: Pick<DriveAPIOperations, "retryQueuedUpload" | "retryAllFailedUploads"> | undefined,
  showError: (message: string) => void,
) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !model || !operations) return;
    done.current = true;
    const scope = takeDriveUploadRetryAfterSignIn();
    if (!scope) return;
    const fail = (error: unknown) =>
      showError(error instanceof Error ? error.message : String(error));
    if (scope === "all") {
      void operations.retryAllFailedUploads?.().catch(fail);
      return;
    }
    for (const item of model.snapshot.items) {
      if (item.status === "failed" && item.error?.code === "auth") {
        void operations.retryQueuedUpload?.(item.id).catch(fail);
      }
    }
  }, [model, operations, showError]);
}
