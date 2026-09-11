import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";

export type DriveStarredListingOperations = Pick<
  DriveAPIOperations,
  "listStars" | "listEntriesByPaths"
>;

/** Build the path→starred map used across Drive views. */
export function driveStarredPathMap(paths: readonly string[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const path of paths) {
    next[path] = true;
  }
  return next;
}

/** Map starred directory entries to `DriveFile` rows (no product filters). */
export function mapDriveStarredEntries(
  entries: Parameters<typeof driveFileFromEntry>[0][],
  username: string,
): DriveFile[] {
  return entries.map((entry) => driveFileFromEntry(entry, username));
}

/**
 * Load starred paths and resolve them to `DriveFile`s.
 * Empty path lists short-circuit without calling `listEntriesByPaths`.
 */
export async function fetchDriveStarredListing(
  operations: DriveStarredListingOperations,
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<{ paths: string[]; files: DriveFile[] }> {
  const paths = await operations.listStars({ signal: opts?.signal });
  if (paths.length === 0) {
    return { paths, files: [] };
  }
  const entries = await operations.listEntriesByPaths(paths, { signal: opts?.signal });
  return { paths, files: mapDriveStarredEntries(entries, username) };
}
