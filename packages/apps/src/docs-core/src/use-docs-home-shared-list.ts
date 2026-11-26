import { useCallback, useMemo } from "react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveShareOperations } from "@/lib/files/drive-types";
import { fetchDriveSharedWithMeListing } from "@/drive-core/src/drive-shared-listing";
import { useDocsHomeListingFetch } from "@/docs-core/src/use-docs-home-listing-fetch";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleSharedFile,
} from "@/docs-core/src/docs-home-shared";

export type UseDocsHomeSharedListOptions = {
  username: string;
  shareOperations?: Pick<DriveShareOperations, "listSharedWithMe">;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
  /** Optional search box value; filters titles client-side. */
  query?: string;
};

export type UseDocsHomeSharedListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Docs home Shared with me — Drive loader + markdown/docs filter + title query. */
export function useDocsHomeSharedList({
  username,
  shareOperations,
  enabled = true,
  query = "",
}: UseDocsHomeSharedListOptions): UseDocsHomeSharedListResult {
  const listSharedWithMe = shareOperations?.listSharedWithMe;
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchDriveSharedWithMeListing({ listSharedWithMe: listSharedWithMe! }, username, { signal }),
    [listSharedWithMe, username],
  );
  const drive = useDocsHomeListingFetch(
    enabled && listSharedWithMe ? load : null,
    "Failed to load shared items",
  );
  const { online } = useConnectivity();
  const files = useMemo(
    () => filterDocsHomeSharedByQuery(drive.files.filter(isDocsHomeCompatibleSharedFile), query),
    [drive.files, query],
  );

  return {
    files,
    loading: drive.loading,
    // Offline the list cannot be refreshed; say so, also when an earlier fetch succeeded.
    error: online ? drive.error : docsLabels.homeSharedOffline,
    reload: drive.reload,
  };
}
