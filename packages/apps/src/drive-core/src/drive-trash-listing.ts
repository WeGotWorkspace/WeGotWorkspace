import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import { driveUserTrashApiPath } from "@/drive-core/src/drive-path-utils";

export type DriveTrashListingOperations = Pick<DriveAPIOperations, "listDirectory">;

/** Map trash directory entries to `DriveFile` rows (no product filters). */
export function mapDriveTrashEntries(
  entries: Parameters<typeof driveFileFromEntry>[0][],
  username: string,
): DriveFile[] {
  return entries.map((entry) => driveFileFromEntry(entry, username));
}

/** True when a listDirectory failure means the trash folder is missing (treat as empty). */
export function isDriveTrashNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found|does not exist/i.test(message);
}

/**
 * List the user's trash directory.
 * Missing trash (404) resolves to an empty array rather than throwing.
 */
export async function fetchDriveTrashListing(
  operations: DriveTrashListingOperations,
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<DriveFile[]> {
  try {
    const data = await operations.listDirectory(driveUserTrashApiPath(username), {
      signal: opts?.signal,
    });
    return mapDriveTrashEntries(data.directory.files, username);
  } catch (error: unknown) {
    if (isDriveTrashNotFoundError(error)) return [];
    throw error;
  }
}
