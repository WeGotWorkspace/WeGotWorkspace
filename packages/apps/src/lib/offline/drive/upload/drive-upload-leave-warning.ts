import { isLastDriveUploaderTab } from "@/lib/offline/drive/upload/drive-upload-last-tab";
import { uploadFromMemory } from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  subscribeDriveUploadQueue,
  type DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

/** How often a running queue re-checks whether another tab would carry on. */
const LAST_TAB_CHECK_MS = 3_000;

/** A waiting or running file whose bytes live only in this tab's memory. */
export function holdsUploadOnlyInMemory(snapshot: DriveUploadQueueSnapshot): boolean {
  return snapshot.items.some(
    (item) =>
      !item.localCopy && item.status !== "failed" && uploadFromMemory(item.id) !== undefined,
  );
}

/**
 * The browser's leave warning while files upload and no other tab would
 * take over, or while this tab alone holds the bytes of a file (#1522).
 * Lives with the uploader, so it outlives the Drive view. Off for every other
 * queue state: waiting files stay queued on the device and go on in the next
 * Drive tab. Returns the function that stops it.
 */
export function startDriveUploadLeaveWarning(username: string): () => void {
  if (typeof window === "undefined") return () => undefined;
  let snapshot: DriveUploadQueueSnapshot | null = null;
  let last = true;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = () =>
    void isLastDriveUploaderTab(username)
      .then((answer) => {
        if (!stopped) last = answer;
      })
      .catch(() => undefined);

  const unsubscribe = subscribeDriveUploadQueue(username, (next) => {
    snapshot = next;
    if (next.state === "running" && !timer) {
      last = true;
      check();
      timer = setInterval(check, LAST_TAB_CHECK_MS);
    } else if (next.state !== "running" && timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  const warn = (event: BeforeUnloadEvent) => {
    if (!snapshot) return;
    const lastRunning = snapshot.state === "running" && last;
    if (!lastRunning && !holdsUploadOnlyInMemory(snapshot)) return;
    event.preventDefault();
    // Older browsers show the prompt only with a return value.
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", warn);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    unsubscribe();
    window.removeEventListener("beforeunload", warn);
  };
}
