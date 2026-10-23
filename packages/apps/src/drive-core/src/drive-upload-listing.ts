import { mapDriveListingEntries } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";

/**
 * Bring the folder's upload placeholders in `previous` in line with the
 * cached listing: drop placeholders that left the queue, show new ones with
 * their current status, and add files that finished uploading. Rows of other
 * folders and real rows the cache already agrees with stay untouched.
 */
export function mergeDriveUploadPlaceholders(
  previous: DriveFile[],
  cached: DriveUIData | null,
  folderUiPath: string,
  username: string,
): DriveFile[] {
  const kept = previous.filter((file) => !(file.parent === folderUiPath && file.upload));
  if (!cached) return kept.length === previous.length ? previous : kept;
  const keptIds = new Set(kept.map((file) => file.id));
  const fromCache = mapDriveListingEntries(cached, username).filter(
    (file) => file.upload || !keptIds.has(file.id),
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
