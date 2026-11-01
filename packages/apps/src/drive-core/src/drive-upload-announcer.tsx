import { useEffect, useRef, useState } from "react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { driveUploadPercent } from "@/drive-core/src/drive-upload-row-state";
import type {
  DriveUploadItemView,
  DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

/** A determinate upload is announced at these steps, never on every byte. */
const PERCENT_STEP = 25;

type Seen = Pick<DriveUploadItemView, "name" | "status" | "bytesDone" | "bytesTotal">;

/**
 * What changed between two snapshots, in words: a file starts uploading,
 * passes a quarter, finishes, or fails. A file that leaves the queue while it
 * was waiting was removed, so it is not announced as uploaded.
 */
export function driveUploadAnnouncements(
  previous: ReadonlyMap<string, Seen>,
  next: readonly DriveUploadItemView[],
): string[] {
  const messages: string[] = [];
  const nextIds = new Set(next.map((item) => item.id));
  for (const [id, before] of previous) {
    if (!nextIds.has(id) && before.status === "uploading") {
      messages.push(driveLabels.uploadAnnounceDone(before.name));
    }
  }
  for (const item of next) {
    const before = previous.get(item.id);
    if (item.status === "failed" && before?.status !== "failed") {
      const reason = item.error ? driveLabels.uploadFailedReason[item.error.code] : "";
      messages.push(driveLabels.uploadAnnounceFailed(item.name, reason));
    } else if (item.status === "uploading" && before?.status !== "uploading") {
      messages.push(driveLabels.uploadAnnounceStarted(item.name));
    } else if (item.status === "uploading" && before) {
      const step = percentStep(item);
      if (step !== null && step > (percentStep(before) ?? 0)) {
        messages.push(driveLabels.uploadAnnounceProgress(item.name, step));
      }
    }
  }
  return messages;
}

function percentStep(item: Seen): number | null {
  const percent = driveUploadPercent(item);
  if (percent === null || percent >= 100) return null;
  return Math.floor(percent / PERCENT_STEP) * PERCENT_STEP || null;
}

/**
 * Polite live region for upload changes, so a screen reader hears progress
 * without focusing the ring. Shows in every tab, like the rings.
 */
export function DriveUploadAnnouncer({ snapshot }: { snapshot: DriveUploadQueueSnapshot | null }) {
  const seen = useRef<Map<string, Seen> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!snapshot) return;
    const previous = seen.current;
    seen.current = new Map(snapshot.items.map((item) => [item.id, item]));
    // The first snapshot is the state on arrival, not a change.
    if (!previous) return;
    const messages = driveUploadAnnouncements(previous, snapshot.items);
    if (messages.length > 0) setMessage(messages.join(". "));
  }, [snapshot]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
