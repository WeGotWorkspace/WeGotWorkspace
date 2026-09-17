import { useMemo } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { useDriveSharedList } from "@/drive-core/src/use-drive-shared-list";
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
  const drive = useDriveSharedList({ username, shareOperations, enabled });
  const files = useMemo(
    () => filterDocsHomeSharedByQuery(drive.files.filter(isDocsHomeCompatibleSharedFile), query),
    [drive.files, query],
  );

  return {
    files,
    loading: drive.loading,
    error: drive.error,
    reload: drive.reload,
  };
}
