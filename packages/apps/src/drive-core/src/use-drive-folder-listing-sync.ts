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
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { useDriveUploadListingRefresh } from "@/drive-core/src/use-drive-upload-listing-refresh";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";

/** Waits before each automatic retry of a failed listing. Try again works at any time. */
export const FOLDER_LISTING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

/**
 * Worth another try: 408, 429, a 5xx, or a network failure. A 403, a 404 or an
 * error without a status (for example "not available offline") is not.
 */
export function isRetryableListingError(error: unknown): boolean {
  if (isFetchNetworkError(error)) return true;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status !== "number") return false;
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
  setHydratedFolderPath: (path: string | null) => void;
  commitView: (view: ViewKey) => void;
  showError: (message: string) => void;
  /** The listing the shell last painted from; upload placeholders are merged in again on change. */
  listing?: unknown;
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
 * can tell "could not load" apart from "empty". A retryable failure (429, 5xx,
 * network) loads again on its own, after {@link FOLDER_LISTING_RETRY_DELAYS_MS}.
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
  listing,
}: UseDriveFolderListingSyncArgs): DriveFolderListingSync {
  useDriveUploadListingRefresh({
    operations,
    folderViewPath,
    currentUsername,
    groupRootNamesRef,
    setFiles,
    listing,
  });
  // Latest callbacks: an unstable identity must not restart (and re-paint) the load.
  const commitViewRef = useRef(commitView);
  commitViewRef.current = commitView;
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;
  const [folderListingError, setFolderListingError] = useState<DriveFolderListingError | null>(
    null,
  );
  const [reloadToken, setReloadToken] = useState(0);
  const failedAttemptsRef = useRef(0);

  useEffect(() => {
    failedAttemptsRef.current = 0;
  }, [folderViewPath]);

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
    let liveSucceeded = false;
    let cachedIds: ReadonlySet<string> = new Set();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const readCached = operations.readCachedDirectory;
    if (readCached) {
      void guardOfflineCacheStep(readCached(apiPath), null).then((cached) => {
        // A failed live load does not drop cached rows that arrive after it.
        if (!cached || liveSucceeded || controller.signal.aborted) return;
        cachedIds = new Set(mapDriveListingEntries(cached, currentUsername).map((file) => file.id));
        setFiles((previous) => mergeDriveFolderListing(previous, cached, currentUsername));
        setHydratedFolderPath(folderViewPath);
        setFolderListingError(null);
      });
    }

    void operations
      .changeDir(apiPath, { signal: controller.signal })
      .then((nextData) => {
        liveSucceeded = true;
        failedAttemptsRef.current = 0;
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
        if (controller.signal.aborted) return;
        pendingFolderRefetchRef.current = false;
        setHydratedFolderPath(folderViewPath);
        const message = error instanceof Error ? error.message : String(error);
        setFolderListingError({ path: folderViewPath, message });
        const attempt = failedAttemptsRef.current;
        failedAttemptsRef.current += 1;
        // One toast per failure streak, not one per automatic retry.
        if (attempt === 0) showErrorRef.current(message);
        const delay = FOLDER_LISTING_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined && isRetryableListingError(error)) {
          retryTimer = setTimeout(() => setReloadToken((token) => token + 1), delay);
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
    reloadToken,
    setFiles,
    setHydratedFolderPath,
    syncedFolderPathRef,
  ]);

  const retryFolderListing = useCallback(() => {
    failedAttemptsRef.current = 0;
    setFolderListingError(null);
    pendingFolderRefetchRef.current = true;
    syncedFolderPathRef.current = null;
    setHydratedFolderPath(null);
    setReloadToken((token) => token + 1);
  }, [pendingFolderRefetchRef, setHydratedFolderPath, syncedFolderPathRef]);

  return { folderListingError, retryFolderListing };
}
