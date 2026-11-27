import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveFile } from "@/lib/files/drive-models";

export type DocsHomeListingFetch = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * One server listing of Docs home (Starred, Shared with me, Trash), loaded
 * while `load` is set and again on `reload`. Drive reads these views from the
 * device's file tree since #2063 C3; Docs home moves there in C4.
 */
export function useDocsHomeListingFetch(
  load: ((signal: AbortSignal) => Promise<DriveFile[]>) | null,
  failedMessage: string,
): DocsHomeListingFetch {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(load !== null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const versionRef = useRef(0);
  const failedRef = useRef(failedMessage);
  failedRef.current = failedMessage;

  useEffect(() => {
    if (!load) {
      setFiles((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      setError(null);
      return;
    }
    const version = versionRef.current + 1;
    versionRef.current = version;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void load(controller.signal)
      .then((next) => {
        if (version !== versionRef.current) return;
        setFiles(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || version !== versionRef.current) return;
        setFiles([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : failedRef.current);
      });
    return () => controller.abort();
  }, [load, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  return { files, loading, error, reload };
}
