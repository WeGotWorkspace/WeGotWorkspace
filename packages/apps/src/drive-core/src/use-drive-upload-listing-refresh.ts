import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath } from "@/drive-core/src/drive-path-utils";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { mergeDriveUploadPlaceholders } from "@/drive-core/src/drive-upload-listing";

export type UseDriveUploadListingRefreshArgs = {
  operations?: DriveAPIOperations;
  /** UI path of the folder view, or null when a virtual view is active. */
  folderViewPath: string | null;
  currentUsername: string;
  groupRootNamesRef: MutableRefObject<Set<string>>;
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
  /**
   * The listing the shell last painted from (boot data). A new one replaces
   * `files` without placeholders, so they are merged in again.
   */
  listing: unknown;
};

/**
 * Re-read the open folder from the offline cache whenever the upload queue
 * changes in any tab, so placeholders appear, change status, and turn into
 * the uploaded file without a server round trip. Also runs once when the
 * folder or the painted listing changes, so placeholders survive a reload,
 * online or offline.
 */
export function useDriveUploadListingRefresh({
  operations,
  folderViewPath,
  currentUsername,
  groupRootNamesRef,
  setFiles,
  listing,
}: UseDriveUploadListingRefreshArgs): void {
  useEffect(() => {
    const subscribe = operations?.subscribeUploadQueue;
    const readCached = operations?.readCachedDirectory;
    if (!subscribe || !readCached || folderViewPath === null || !currentUsername.trim()) return;
    let active = true;
    const apiPath = apiPathFromUiPath(folderViewPath, currentUsername, groupRootNamesRef.current);
    const refresh = (placeholdersOnly: boolean) => {
      void readCached(apiPath)
        .then((cached) => {
          if (!active) return;
          setFiles((previous) =>
            mergeDriveUploadPlaceholders(previous, cached, folderViewPath, currentUsername, {
              placeholdersOnly,
            }),
          );
        })
        .catch((error: unknown) => console.warn("[drive-upload] listing refresh failed", error));
    };
    const unsubscribe = subscribe(() => refresh(false));
    refresh(true);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUsername, folderViewPath, groupRootNamesRef, listing, operations, setFiles]);
}
