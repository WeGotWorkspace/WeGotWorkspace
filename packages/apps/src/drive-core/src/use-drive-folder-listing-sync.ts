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

/** Waits before each automatic retry of a failed listing. The Retry button works at any time. */
export const FOLDER_LISTING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

/** A listing that failed and has no cached rows to show instead. */
export type DriveFolderListingError = { path: string; message: string };

/** Too many requests, a server error, or no HTTP status at all (network): worth another try. */
export function isRetryableListingError(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}

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
  setHydratedFolderPath: (path: string) => void;
  commitView: (view: ViewKey) => void;
  showError: (message: string) => void;
};

/**
 * Load the folder view's listing cache-first: cached rows paint at once
 * (clearing the pending state), then `changeDir` replaces them in place.
 *
 * A failed listing never reads as an empty folder: without cached rows it
 * reports {@link DriveFolderListingError}, and a retryable failure (429, 5xx,
 * network) tries again on its own.
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
}: UseDriveFolderListingSyncArgs) {
  // Latest callbacks: an unstable identity must not restart (and re-paint) the load.
  const commitViewRef = useRef(commitView);
  commitViewRef.current = commitView;
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;
  const [listingError, setListingError] = useState<DriveFolderListingError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const failedAttemptsRef = useRef(0);

  useEffect(() => {
    failedAttemptsRef.current = 0;
    setListingError(null);
  }, [folderViewPath]);

  const retryListing = useCallback(() => {
    failedAttemptsRef.current = 0;
    setRetryNonce((nonce) => nonce + 1);
  }, []);

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

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
        failedAttemptsRef.current = 0;
        setListingError(null);
        const resolvedPath = uiPathFromApiPath(nextData.cwd, currentUsername);
        pendingFolderRefetchRef.current = false;
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
        const attempt = failedAttemptsRef.current;
        failedAttemptsRef.current += 1;
        // Cached rows stay on screen; without them the pane shows the error, not "empty".
        if (cachedIds.size > 0) {
          if (attempt === 0) showErrorRef.current(message);
        } else {
          setListingError({ path: folderViewPath, message });
        }
        const delay = FOLDER_LISTING_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined && isRetryableListingError(error)) {
          retryTimer = setTimeout(() => setRetryNonce((nonce) => nonce + 1), delay);
        }
      });

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [
    currentUsername,
    folderViewPath,
    groupRootNamesRef,
    listLoading,
    operations,
    pendingFolderRefetchRef,
    retryNonce,
    setFiles,
    setHydratedFolderPath,
    syncedFolderPathRef,
  ]);

  return { listingError, retryListing };
}
