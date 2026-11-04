import { mapDriveListingEntries } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveUploadBatchRequest } from "@/drive-core/src/drive-upload-batch-dialog";
import { hasDriveUploadBatchQuestions } from "@/lib/offline/drive/upload/drive-upload-batch-questions";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";

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
 * Queue picked files. A batch with questions (server space, name conflicts,
 * keep offline) goes to `ask`, which shows the batch dialog; the dialog
 * releases or cancels it. A batch without questions (or a caller without a
 * dialog) is released right away with the default answer (`remove`).
 */
export async function queueDriveUploadBatch(
  operations: Required<Pick<DriveAPIOperations, "enqueueUploads" | "releaseUploadBatch">>,
  input: DriveUploadInput,
  onStored?: (batch: DriveStoredUploadBatch) => void,
  ask?: (request: DriveUploadBatchRequest) => void,
): Promise<string> {
  const { batchId, itemIds = [], questions } = await operations.enqueueUploads(input);
  if (ask && questions && hasDriveUploadBatchQuestions(questions)) {
    ask({ batchId, itemIds, questions });
    return batchId;
  }
  // Before release: the uploader cannot start (or finish) the batch yet.
  onStored?.({ batchId, itemIds });
  await operations.releaseUploadBatch(batchId, { keepOffline: "remove" });
  return batchId;
}

/** Picked files, or a folder tree (#1620) with `files` empty. */
export type DriveUploadInput = Parameters<NonNullable<DriveAPIOperations["enqueueUploads"]>>[0];

export type DriveStoredUploadBatch = { batchId: string; itemIds: readonly string[] };

/**
 * Queue picked files when this Drive has the upload queue (signed in, offline
 * layer). Returns false when it does not, so the caller uploads directly.
 */
export function queuePickedDriveUploads(
  operations: Pick<DriveAPIOperations, "enqueueUploads" | "releaseUploadBatch"> | undefined,
  input: DriveUploadInput,
  showError: (message: string) => void,
  onStored?: (batch: DriveStoredUploadBatch) => void,
  ask?: (request: DriveUploadBatchRequest) => void,
): boolean {
  const enqueueUploads = operations?.enqueueUploads;
  const releaseUploadBatch = operations?.releaseUploadBatch;
  if (!enqueueUploads || !releaseUploadBatch) return false;
  void queueDriveUploadBatch({ enqueueUploads, releaseUploadBatch }, input, onStored, ask).catch(
    (error: unknown) => showError(error instanceof Error ? error.message : String(error)),
  );
  return true;
}
