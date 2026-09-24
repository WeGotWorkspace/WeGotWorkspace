import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  fetchDriveTrashListing,
  type DriveTrashListingOperations,
} from "@/drive-core/src/drive-trash-listing";

export type UseDriveTrashListOptions = {
  username: string;
  operations?: DriveTrashListingOperations;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
};

export type UseDriveTrashListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Drive trash directory listing hook (folders + all file kinds; 404 → empty). */
export function useDriveTrashList({
  username,
  operations,
  enabled = true,
}: UseDriveTrashListOptions): UseDriveTrashListResult {
  const listDirectory = operations?.listDirectory;
  const shouldLoad = Boolean(enabled && listDirectory && username.trim());
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    if (!shouldLoad || !listDirectory) {
      setFiles((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      setError(null);
      return;
    }

    const requestVersion = loadVersionRef.current + 1;
    loadVersionRef.current = requestVersion;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchDriveTrashListing({ listDirectory }, username, { signal: controller.signal })
      .then((next) => {
        if (requestVersion !== loadVersionRef.current) return;
        setFiles(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || requestVersion !== loadVersionRef.current) return;
        setFiles([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load trash");
      });

    return () => {
      controller.abort();
    };
  }, [listDirectory, reloadToken, shouldLoad, username]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { files, loading, error, reload };
}
