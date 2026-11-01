import { mapDriveListingEntries } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import { driveLabels } from "@/drive-core/src/drive-labels";
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
  onStored?: (batch: DriveStoredUploadBatch) => void,
): Promise<string> {
  const { batchId, itemIds } = await operations.enqueueUploads(input);
  // Before release: the uploader cannot start (or finish) the batch yet.
  onStored?.({ batchId, itemIds: itemIds ?? [] });
  await operations.releaseUploadBatch(batchId, { keepOffline: "remove" });
  return batchId;
}

export type DriveStoredUploadBatch = { batchId: string; itemIds: string[] };

/**
 * Queue picked files when this Drive has the upload queue (signed in, offline
 * layer). Returns false when it does not, so the caller uploads directly.
 */
export function queuePickedDriveUploads(
  operations: Pick<DriveAPIOperations, "enqueueUploads" | "releaseUploadBatch"> | undefined,
  input: { cwd: string; files: File[] },
  showError: (message: string) => void,
  onStored?: (batch: DriveStoredUploadBatch) => void,
): boolean {
  const enqueueUploads = operations?.enqueueUploads;
  const releaseUploadBatch = operations?.releaseUploadBatch;
  if (!enqueueUploads || !releaseUploadBatch) return false;
  void queueDriveUploadBatch({ enqueueUploads, releaseUploadBatch }, input, onStored).catch(
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
      ? driveLabels.uploadingFile(progress.currentFileName)
      : driveLabels.uploadingFiles(progress.filesTotal);
  const detail = driveLabels.uploadProgressDetail(
    formatBytesCompact(progress.uploadedBytes),
    formatBytesCompact(progress.totalBytes),
    progress.filesCompleted,
    progress.filesTotal,
  );
  return { label, percent, detail, done: false };
}

/** First frame of a direct upload, before the first progress event. */
export function driveUploadStartView(files: readonly File[]): DriveUploadProgressView {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    label:
      files.length === 1
        ? driveLabels.uploadingFile(files[0]!.name)
        : driveLabels.uploadingFiles(files.length),
    percent: 0,
    detail: `0 / ${formatBytesCompact(totalBytes)}`,
    done: false,
  };
}

/** Last frame of a direct upload. */
export function driveUploadDoneView(count: number): DriveUploadProgressView {
  return {
    label: driveLabels.uploadDoneToast(count),
    percent: 100,
    detail: driveLabels.uploadComplete,
    done: true,
  };
}
