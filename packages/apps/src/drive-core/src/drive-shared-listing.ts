import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { driveFileFromSharedWithMeEntry } from "@/drive-core/src/drive-file-utils";
import type { DriveSharedWithMeEntry } from "@wgw-api-generated/drive-types";

export type DriveSharedListingOperations = Pick<DriveShareOperations, "listSharedWithMe">;

/** Map `shared-with-me` API entries to Drive files (drops unresolvable rows). */
export function mapDriveSharedWithMeEntries(
  entries: readonly DriveSharedWithMeEntry[],
  username: string,
): DriveFile[] {
  const files: DriveFile[] = [];
  for (const entry of entries) {
    const file = driveFileFromSharedWithMeEntry(entry, username);
    if (file) files.push(file);
  }
  return files;
}

/** Load Shared with me entries and map them to `DriveFile`s. */
export async function fetchDriveSharedWithMeListing(
  operations: DriveSharedListingOperations,
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<DriveFile[]> {
  const entries = await operations.listSharedWithMe({ signal: opts?.signal });
  return mapDriveSharedWithMeEntries(entries, username);
}
