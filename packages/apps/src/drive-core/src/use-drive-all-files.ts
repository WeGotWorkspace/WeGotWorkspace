import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

/** Index page size for All Files (the search API's maximum). */
export const DRIVE_ALL_FILES_PAGE_SIZE = 100;

const GROUPS_ROOT = "Groups";

/**
 * All Files rows name their drive the way the sidebar does: Personal, or the
 * team drive's display name instead of its slug.
 */
export function withDriveRootLocation(
  file: DriveFile,
  rootLabels: Readonly<Record<string, string>>,
): DriveFile {
  const segments = file.parent.split("/");
  if (segments[0] !== GROUPS_ROOT || !segments[1]) return file;
  const label = rootLabels[`${GROUPS_ROOT}/${segments[1]}`];
  return label ? { ...file, location: label } : file;
}

/** Changes the All Files rows in place (no-op outside All Files). */
export type DriveAllFilesPatch = (update: (rows: DriveFile[]) => DriveFile[]) => void;

/**
 * Shows a write on the All Files rows at once (`update`) and returns the undo: the
 * rows as they were, then a reload. Outside All Files both are no-ops.
 */
export function patchAllFilesRows(
  view: ViewKey,
  patch: DriveAllFilesPatch | undefined,
  reload: (() => void) | undefined,
  update: (rows: DriveFile[]) => DriveFile[],
): () => void {
  if (view.type !== "all" || !patch) return () => undefined;
  let before: DriveFile[] | null = null;
  patch((rows) => {
    before ??= rows;
    return update(rows);
  });
  return () => {
    const rows = before;
    if (rows) patch(() => rows);
    reload?.();
  };
}

/** The rows `ids` name, from any view (All Files, Starred, Shared, the open folder). */
export function driveRowsById(
  ids: readonly string[],
  fileById: (id: string) => DriveFile | null,
): DriveFile[] {
  const rows = new Map<string, DriveFile>();
  for (const id of ids) {
    const row = fileById(id);
    if (row) rows.set(row.id, row);
  }
  return [...rows.values()];
}

export type UseDriveAllFilesArgs = {
  operations?: DriveAPIOperations;
  view: ViewKey;
  currentUsername: string;
  rootLabels: Readonly<Record<string, string>>;
  showError: (message: string) => void;
};

/**
 * All Files (the Drive home): every file across the viewer's drives, newest
 * first, one index page at a time. Without `listAllFiles` (guests, Storybook
 * mocks) `allItems` stays null and the view lists the files already loaded.
 */
export function useDriveAllFiles({
  operations,
  view,
  currentUsername,
  rootLabels,
  showError,
}: UseDriveAllFilesArgs) {
  const listAllFiles = operations?.listAllFiles;
  const active = view.type === "all" && listAllFiles !== undefined;
  const [items, setItems] = useState<DriveFile[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextOffsetRef = useRef(0);
  const versionRef = useRef(0);
  // Callers often pass a fresh callback each render; it must not restart the listing.
  const showErrorRef = useRef(showError);
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  const loadPage = useCallback(
    async (offset: number, version: number, signal?: AbortSignal) => {
      if (!listAllFiles) return;
      const page = await listAllFiles({ offset, limit: DRIVE_ALL_FILES_PAGE_SIZE }, { signal });
      if (version !== versionRef.current) return;
      const files = page.entries.map((entry) => driveFileFromEntry(entry, currentUsername));
      nextOffsetRef.current = page.nextOffset;
      setHasMore(page.hasMore);
      setItems((previous) => {
        if (offset === 0 || previous === null) return files;
        const seen = new Set(previous.map((file) => file.id));
        return [...previous, ...files.filter((file) => !seen.has(file.id))];
      });
    },
    [currentUsername, listAllFiles],
  );

  const reload = useCallback(
    (signal?: AbortSignal) => {
      const version = versionRef.current + 1;
      versionRef.current = version;
      setLoadingMore(false);
      void loadPage(0, version, signal).catch((error: unknown) => {
        if (signal?.aborted || version !== versionRef.current) return;
        setItems((previous) => previous ?? []);
        showErrorRef.current(error instanceof Error ? error.message : String(error));
      });
    },
    [loadPage],
  );

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [active, reload]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    const version = versionRef.current;
    setLoadingMore(true);
    void loadPage(nextOffsetRef.current, version)
      .catch((error: unknown) => {
        if (version !== versionRef.current) return;
        showErrorRef.current(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (version === versionRef.current) setLoadingMore(false);
      });
  }, [hasMore, loadPage, loadingMore]);

  const patchAllFiles = useCallback<DriveAllFilesPatch>((update) => {
    setItems((previous) => (previous ? update(previous) : previous));
  }, []);

  const labeledItems = useMemo(
    () => items?.map((file) => withDriveRootLocation(file, rootLabels)) ?? null,
    [items, rootLabels],
  );

  return {
    /** Null outside All Files, and when the rows come from the loaded files instead. */
    allItems: active ? labeledItems : null,
    /** All Files is waiting for its first page. */
    allLoading: active && items === null,
    allHasMore: active && hasMore,
    allLoadingMore: loadingMore,
    loadMoreAll: loadMore,
    reloadAllFiles: reload,
    patchAllFiles,
  };
}
