import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  mapDriveListingEntries,
  mergeDriveFolderListing,
} from "@/drive-core/src/drive-batch-utils";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath, uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";

export type UseDriveFolderListingSyncArgs = {
  operations?: DriveAPIOperations;
  /** UI path of the folder view, or null when a virtual view is active. */
  folderViewPath: string | null;
  listLoading: boolean;
  currentUsername: string;
  groupRootNamesRef: MutableRefObject<Set<string>>;
  /** Folder whose rows `files` already holds; skips the fetch when it matches. */
  syncedFolderPathRef: MutableRefObject<string | null>;
  pendingFolderRefetchRef: MutableRefObject<boolean>;
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
  setHydratedFolderPath: (path: string | null) => void;
  commitView: (view: ViewKey) => void;
  showError: (message: string) => void;
};

/** A live folder load that failed, keyed by the folder UI path it belongs to. */
export type DriveFolderListingError = { path: string; message: string };

export type DriveFolderListingSync = {
  folderListingError: DriveFolderListingError | null;
  /** Clears the error and loads the current folder again (pending state shows meanwhile). */
  retryFolderListing: () => void;
};

/**
 * Load the folder view's listing cache-first: cached rows paint at once
 * (clearing the pending state), then `changeDir` replaces them in place.
 * A failed live load is kept as {@link DriveFolderListingError} so the pane
 * can tell "could not load" apart from "empty".
 */
export function useDriveFolderListingSync({
  operations,
  folderViewPath,
  listLoading,
  currentUsername,
  groupRootNamesRef,
  syncedFolderPathRef,
  pendingFolderRefetchRef,
  setFiles,
  setHydratedFolderPath,
  commitView,
  showError,
}: UseDriveFolderListingSyncArgs): DriveFolderListingSync {
  // Latest callbacks: an unstable identity must not restart (and re-paint) the load.
  const commitViewRef = useRef(commitView);
  commitViewRef.current = commitView;
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;
  const [folderListingError, setFolderListingError] = useState<DriveFolderListingError | null>(
    null,
  );
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!operations || folderViewPath === null || listLoading || !currentUsername.trim()) {
      return;
    }
    if (syncedFolderPathRef.current === folderViewPath) {
      setHydratedFolderPath(folderViewPath);
      return;
    }

    const controller = new AbortController();
    const apiPath = apiPathFromUiPath(folderViewPath, currentUsername, groupRootNamesRef.current);
    let liveSettled = false;
    let cachedIds: ReadonlySet<string> = new Set();

    const readCached = operations.readCachedDirectory;
    if (readCached) {
      void guardOfflineCacheStep(readCached(apiPath), null).then((cached) => {
        if (!cached || liveSettled || controller.signal.aborted) return;
        cachedIds = new Set(mapDriveListingEntries(cached, currentUsername).map((file) => file.id));
        setFiles((previous) => mergeDriveFolderListing(previous, cached, currentUsername));
        setHydratedFolderPath(folderViewPath);
      });
    }

    void operations
      .changeDir(apiPath, { signal: controller.signal })
      .then((nextData) => {
        liveSettled = true;
        const resolvedPath = uiPathFromApiPath(nextData.cwd, currentUsername);
        pendingFolderRefetchRef.current = false;
        setFolderListingError(null);
        syncedFolderPathRef.current = resolvedPath;
        // Cached rows the server no longer lists must not survive as staged rows.
        setFiles((previous) =>
          mergeDriveFolderListing(
            previous.filter((file) => !cachedIds.has(file.id)),
            nextData,
            currentUsername,
          ),
        );
        setHydratedFolderPath(resolvedPath);
        if (resolvedPath !== folderViewPath) {
          commitViewRef.current({ type: "folder", path: resolvedPath });
        }
      })
      .catch((error: unknown) => {
        liveSettled = true;
        if (controller.signal.aborted) return;
        pendingFolderRefetchRef.current = false;
        setHydratedFolderPath(folderViewPath);
        const message = error instanceof Error ? error.message : String(error);
        setFolderListingError({ path: folderViewPath, message });
        showErrorRef.current(message);
      });

    return () => controller.abort();
  }, [
    currentUsername,
    folderViewPath,
    groupRootNamesRef,
    listLoading,
    operations,
    pendingFolderRefetchRef,
    reloadToken,
    setFiles,
    setHydratedFolderPath,
    syncedFolderPathRef,
  ]);

  const retryFolderListing = useCallback(() => {
    setFolderListingError(null);
    pendingFolderRefetchRef.current = true;
    syncedFolderPathRef.current = null;
    setHydratedFolderPath(null);
    setReloadToken((token) => token + 1);
  }, [pendingFolderRefetchRef, setHydratedFolderPath, syncedFolderPathRef]);

  return { folderListingError, retryFolderListing };
}
