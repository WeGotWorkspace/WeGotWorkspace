import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { mergeDriveFolderListing } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import { apiPathFromUiPath, uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import type { DriveAPIOperations } from "@/lib/files/drive-types";

export type UseDriveServerFolderArgs = {
  /** False when the view reads the local tree instead. */
  enabled: boolean;
  operations?: DriveAPIOperations;
  folderViewPath: string | null;
  currentUsername: string;
  groupRootNames: Set<string>;
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
  commitView: (view: ViewKey) => void;
  showError: (message: string) => void;
  /** UI path of the folder the boot listing already holds; its first open sends nothing. */
  bootFolderPath: string | null;
};

export type DriveServerFolderState = {
  /** The open folder has not loaded yet. */
  pending: boolean;
  /** The open folder's listing failed: never shown as empty. */
  failed: boolean;
  retry: () => void;
};

/**
 * Folder rows for sessions without a local tree (share-link guests): one
 * `changeDir` per opened folder. Members never get here; their folders come
 * from the tree (#2063 C3).
 */
export function useDriveServerFolder({
  enabled,
  operations,
  folderViewPath,
  currentUsername,
  groupRootNames,
  setFiles,
  commitView,
  showError,
  bootFolderPath,
}: UseDriveServerFolderArgs): DriveServerFolderState {
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const bootUsedRef = useRef(false);
  const callbacks = useRef({ commitView, showError });
  callbacks.current = { commitView, showError };
  const groupRootsRef = useRef(groupRootNames);
  groupRootsRef.current = groupRootNames;

  useEffect(() => {
    if (!enabled || !operations || !currentUsername.trim()) return;
    const firstOpen = !bootUsedRef.current;
    bootUsedRef.current = true;
    if (folderViewPath === null) return;
    if (firstOpen && bootFolderPath === folderViewPath) {
      setLoadedPath(folderViewPath);
      return;
    }
    setFailedPath(null);
    const controller = new AbortController();
    const apiPath = apiPathFromUiPath(folderViewPath, currentUsername, groupRootsRef.current);
    void operations
      .changeDir(apiPath, { signal: controller.signal })
      .then((data) => {
        const resolved = uiPathFromApiPath(data.cwd, currentUsername);
        setFiles((previous) => mergeDriveFolderListing(previous, data, currentUsername));
        setLoadedPath(resolved);
        if (resolved !== folderViewPath)
          callbacks.current.commitView({ type: "folder", path: resolved });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailedPath(folderViewPath);
        callbacks.current.showError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [attempt, bootFolderPath, currentUsername, enabled, folderViewPath, operations, setFiles]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const open = enabled && !!operations && folderViewPath !== null;
  const failed = open && failedPath === folderViewPath;
  return { pending: open && !failed && loadedPath !== folderViewPath, failed, retry };
}
