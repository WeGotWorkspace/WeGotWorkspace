import { useCallback, useMemo } from "react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { fetchDriveStarredListing } from "@/drive-core/src/drive-starred-listing";
import { useDocsHomeListingFetch } from "@/docs-core/src/use-docs-home-listing-fetch";
import { isDriveUnderTrash } from "@/drive-core/src/drive-visible-items";
import {
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleSharedFile,
} from "@/docs-core/src/docs-home-shared";

export type UseDocsHomeStarredListOptions = {
  username: string;
  operations?: Pick<DriveAPIOperations, "listStars" | "listEntriesByPaths">;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
  /** Optional search box value; filters titles client-side. */
  query?: string;
};

export type UseDocsHomeStarredListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Keep Docs-compatible starred files (excludes folders, binaries, and trash). */
export function mapDocsHomeStarredEntries(files: readonly DriveFile[]): DriveFile[] {
  return files.filter(
    (file) => isDocsHomeCompatibleSharedFile(file) && !isDriveUnderTrash(file.parent),
  );
}

/** Docs home starred list — Drive loader + markdown/docs filter + title query. */
export function useDocsHomeStarredList({
  username,
  operations,
  enabled = true,
  query = "",
}: UseDocsHomeStarredListOptions): UseDocsHomeStarredListResult {
  const listStars = operations?.listStars;
  const listEntriesByPaths = operations?.listEntriesByPaths;
  const load = useCallback(
    async (signal: AbortSignal) =>
      (
        await fetchDriveStarredListing(
          { listStars: listStars!, listEntriesByPaths: listEntriesByPaths! },
          username,
          { signal },
        )
      ).files,
    [listEntriesByPaths, listStars, username],
  );
  const drive = useDocsHomeListingFetch(
    enabled && listStars && listEntriesByPaths ? load : null,
    "Failed to load starred items",
  );
  const files = useMemo(
    () => filterDocsHomeSharedByQuery(mapDocsHomeStarredEntries(drive.files), query),
    [drive.files, query],
  );

  return {
    files,
    loading: drive.loading,
    error: drive.error,
    reload: drive.reload,
  };
}
