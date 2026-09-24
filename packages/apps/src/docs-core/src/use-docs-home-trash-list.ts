import { useMemo } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { useDriveTrashList } from "@/drive-core/src/use-drive-trash-list";
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
  const drive = useDriveTrashList({ username, operations, enabled });
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
