import { useEffect, useRef } from "react";
import type { DriveUploadQueueModel } from "@/drive-core/src/drive-upload-queue";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { takeDriveUploadRetryAfterSignIn } from "@/drive-core/src/drive-upload-sign-in";
import { isLastDriveUploaderTab } from "@/lib/offline/drive/upload/drive-upload-last-tab";
import type { DriveUploadQueueState } from "@/lib/offline/drive/upload/drive-upload-subscription";

/** How often a running queue re-checks whether another tab would carry on. */
const LAST_TAB_CHECK_MS = 3_000;

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

/**
 * The browser's leave warning while files upload and no other tab would
 * take over (#1522). Off for every other queue state: waiting files stay
 * queued on the device and go on in the next Drive tab.
 */
export function useDriveUploadLeaveWarning(
  state: DriveUploadQueueState | undefined,
  username: string | null | undefined,
) {
  useEffect(() => {
    if (state !== "running" || !username) return;
    let last = true;
    let cancelled = false;
    const check = () =>
      void isLastDriveUploaderTab(username)
        .then((answer) => {
          if (!cancelled) last = answer;
        })
        .catch(() => undefined);
    check();
    const timer = window.setInterval(check, LAST_TAB_CHECK_MS);
    const warn = (event: BeforeUnloadEvent) => {
      if (!last) return;
      event.preventDefault();
      // Older browsers show the prompt only with a return value.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [state, username]);
}
