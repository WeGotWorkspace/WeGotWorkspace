import { mapDriveListingEntries } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import type {
  DriveAPIOperations,
  DriveUIData,
  DriveUploadProgress,
} from "@/drive-core/src/drive-types";

/**
 * Bring the folder's upload placeholders in `previous` in line with the
 * cached listing: drop placeholders that left the queue, show new ones with
 * their current status, and add files that finished uploading. Rows of other
 * folders and real rows the cache already agrees with stay untouched.
 * `placeholdersOnly` leaves real rows alone: for a listing that was just
 * loaded, where the cache may be older than what is on screen.
 */
export function mergeDriveUploadPlaceholders(
  previous: DriveFile[],
  cached: DriveUIData | null,
  folderUiPath: string,
  username: string,
  options: { placeholdersOnly?: boolean } = {},
): DriveFile[] {
  const kept = previous.filter((file) => !(file.parent === folderUiPath && file.upload));
  if (!cached) return kept.length === previous.length ? previous : kept;
  const keptIds = new Set(kept.map((file) => file.id));
  const fromCache = mapDriveListingEntries(cached, username).filter(
    (file) => file.upload || (!options.placeholdersOnly && !keptIds.has(file.id)),
  );
  return [...kept, ...fromCache];
}

/**
 * Queue picked files and release the batch right away. No batch dialog step
 * exists yet, so files above the device offline limit get the default answer
 * (`remove`); #1521 puts the dialog between queueing and releasing.
 */
export async function queueDriveUploadBatch(
  operations: Required<Pick<DriveAPIOperations, "enqueueUploads" | "releaseUploadBatch">>,
  input: { cwd: string; files: File[] },
): Promise<string> {
  const { batchId } = await operations.enqueueUploads(input);
  await operations.releaseUploadBatch(batchId, { keepOffline: "remove" });
  return batchId;
}

/**
 * Queue picked files when this Drive has the upload queue (signed in, offline
 * layer). Returns false when it does not, so the caller uploads directly.
 */
export function queuePickedDriveUploads(
  operations: Pick<DriveAPIOperations, "enqueueUploads" | "releaseUploadBatch"> | undefined,
  input: { cwd: string; files: File[] },
  showError: (message: string) => void,
): boolean {
  const enqueueUploads = operations?.enqueueUploads;
  const releaseUploadBatch = operations?.releaseUploadBatch;
  if (!enqueueUploads || !releaseUploadBatch) return false;
  void queueDriveUploadBatch({ enqueueUploads, releaseUploadBatch }, input).catch(
    (error: unknown) => showError(error instanceof Error ? error.message : String(error)),
  );
  return true;
}

/** Progress bar state of a direct (not queued) upload. */
export type DriveUploadProgressView = {
  label: string;
  percent: number;
  detail: string;
  done: boolean;
};

export function driveUploadProgressView(progress: DriveUploadProgress): DriveUploadProgressView {
  const totalBytes = Math.max(1, progress.totalBytes);
  const percent = Math.min(100, Math.round((progress.uploadedBytes / totalBytes) * 100));
  const label =
    progress.currentFileName.trim() !== ""
      ? `Uploading ${progress.currentFileName}`
      : "Uploading files";
  const detail = `${formatBytesCompact(progress.uploadedBytes)} / ${formatBytesCompact(progress.totalBytes)} · ${progress.filesCompleted}/${progress.filesTotal} files`;
  return { label, percent, detail, done: false };
}
