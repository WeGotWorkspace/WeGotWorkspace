import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import {
  filterDocsHomeSharedByQuery,
  mapDocsHomeSharedEntries,
} from "@/docs-core/src/docs-home-shared";

export type UseDocsHomeSharedListOptions = {
  username: string;
  shareOperations?: Pick<DriveShareOperations, "listSharedWithMe">;
  /** When false, skips fetching and returns an empty list. */
  enabled?: boolean;
  /** Optional search box value; filters titles client-side. */
  query?: string;
};

export type UseDocsHomeSharedListResult = {
  files: DriveFile[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useDocsHomeSharedList({
  username,
  shareOperations,
  enabled = true,
  query = "",
}: UseDocsHomeSharedListOptions): UseDocsHomeSharedListResult {
  const listSharedWithMe = shareOperations?.listSharedWithMe;
  const shouldLoad = Boolean(enabled && listSharedWithMe);
  const [items, setItems] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    if (!shouldLoad || !listSharedWithMe) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestVersion = loadVersionRef.current + 1;
    loadVersionRef.current = requestVersion;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void listSharedWithMe({ signal: controller.signal })
      .then((entries) => {
        if (requestVersion !== loadVersionRef.current) return;
        setItems(mapDocsHomeSharedEntries(entries, username));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || requestVersion !== loadVersionRef.current) return;
        setItems([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load shared documents");
      });

    return () => {
      controller.abort();
    };
  }, [listSharedWithMe, reloadToken, shouldLoad, username]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const files = useMemo(() => filterDocsHomeSharedByQuery(items, query), [items, query]);

  return { files, loading, error, reload };
}
