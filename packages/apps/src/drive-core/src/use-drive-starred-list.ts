import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  fetchDriveStarredListing,
  type DriveStarredListingOperations,
} from "@/drive-core/src/drive-starred-listing";

export type UseDriveStarredListOptions = {
  username: string;
  operations?: DriveStarredListingOperations;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
};

export type UseDriveStarredListResult = {
  files: DriveFile[];
  paths: string[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/** Drive starred listing hook (all file kinds; no Docs extension filter). */
export function useDriveStarredList({
  username,
  operations,
  enabled = true,
}: UseDriveStarredListOptions): UseDriveStarredListResult {
  const listStars = operations?.listStars;
  const listEntriesByPaths = operations?.listEntriesByPaths;
  const shouldLoad = Boolean(enabled && listStars && listEntriesByPaths);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    if (!shouldLoad || !listStars || !listEntriesByPaths) {
      setFiles((prev) => (prev.length === 0 ? prev : []));
      setPaths((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      setError(null);
      return;
    }

    const requestVersion = loadVersionRef.current + 1;
    loadVersionRef.current = requestVersion;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchDriveStarredListing({ listStars, listEntriesByPaths }, username, {
      signal: controller.signal,
    })
      .then((result) => {
        if (requestVersion !== loadVersionRef.current) return;
        setPaths(result.paths);
        setFiles(result.files);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || requestVersion !== loadVersionRef.current) return;
        setPaths([]);
        setFiles([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load starred items");
      });

    return () => {
      controller.abort();
    };
  }, [listEntriesByPaths, listStars, reloadToken, shouldLoad, username]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { files, paths, loading, error, reload };
}
