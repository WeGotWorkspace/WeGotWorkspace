import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  fetchDriveSharedWithMeListing,
  type DriveSharedListingOperations,
} from "@/drive-core/src/drive-shared-listing";

export type UseDriveSharedListOptions = {
  username: string;
  shareOperations?: DriveSharedListingOperations;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
};

export type UseDriveSharedListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Drive Shared with me listing hook (folders + all file kinds). */
export function useDriveSharedList({
  username,
  shareOperations,
  enabled = true,
}: UseDriveSharedListOptions): UseDriveSharedListResult {
  const listSharedWithMe = shareOperations?.listSharedWithMe;
  const shouldLoad = Boolean(enabled && listSharedWithMe);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    if (!shouldLoad || !listSharedWithMe) {
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

    void fetchDriveSharedWithMeListing({ listSharedWithMe }, username, {
      signal: controller.signal,
    })
      .then((next) => {
        if (requestVersion !== loadVersionRef.current) return;
        setFiles(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || requestVersion !== loadVersionRef.current) return;
        setFiles([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load shared items");
      });

    return () => {
      controller.abort();
    };
  }, [listSharedWithMe, reloadToken, shouldLoad, username]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { files, loading, error, reload };
}
