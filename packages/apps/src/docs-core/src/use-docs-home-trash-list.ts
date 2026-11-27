import { useCallback, useMemo } from "react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { fetchDriveTrashListing } from "@/drive-core/src/drive-trash-listing";
import { useDocsHomeListingFetch } from "@/docs-core/src/use-docs-home-listing-fetch";
import {
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleSharedFile,
} from "@/docs-core/src/docs-home-shared";

export type UseDocsHomeTrashListOptions = {
  username: string;
  operations?: Pick<DriveAPIOperations, "listDirectory">;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
  /** Optional search box value; filters titles client-side. */
  query?: string;
};

export type UseDocsHomeTrashListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Keep Docs-compatible trash files (excludes folders and binaries). */
export function mapDocsHomeTrashEntries(files: readonly DriveFile[]): DriveFile[] {
  return files.filter(isDocsHomeCompatibleSharedFile);
}

/** Docs home trash list — Drive loader (404→empty) + markdown/docs filter + title query. */
export function useDocsHomeTrashList({
  username,
  operations,
  enabled = true,
  query = "",
}: UseDocsHomeTrashListOptions): UseDocsHomeTrashListResult {
  const listDirectory = operations?.listDirectory;
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchDriveTrashListing({ listDirectory: listDirectory! }, username, { signal }),
    [listDirectory, username],
  );
  const drive = useDocsHomeListingFetch(
    enabled && listDirectory && username.trim() ? load : null,
    "Failed to load trash",
  );
  const files = useMemo(
    () => filterDocsHomeSharedByQuery(mapDocsHomeTrashEntries(drive.files), query),
    [drive.files, query],
  );

  return {
    files,
    loading: drive.loading,
    error: drive.error,
    reload: drive.reload,
  };
}
