import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { subscribeStarredPathsChanged } from "@/lib/offline/docs/docs-stars-store";
import { subscribeDriveRemoteChanges } from "@/lib/offline/drive/drive-file-node-push";
import type { FileTreeEntryFilter, FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import { queryFileTreeView, type FileTreeViewResult } from "@/lib/files/tree-view/tree-view-query";

export type FileTreeViewState = FileTreeViewResult & {
  /** False until the first read for this view and filter has answered. */
  settled: boolean;
};

const UNSETTLED: FileTreeViewState = { rows: [], status: "first-sync", settled: false };

/**
 * One view of the device's file tree (#2063 C2), shared by Drive and Docs home.
 * Reads `drive_entries` through its indexes and reads again whenever the Drive
 * cache changes in any tab (the cross-tab cache-changed topic), the star set
 * changes, or connectivity flips. No Dexie `liveQuery`.
 *
 * `status`: `first-sync` while the first pass on this device has not finished
 * (full-pane loading only when `rows` is empty), `not-available` offline before
 * then with no rows, `ready` once the view is known complete; a ready view with
 * no rows is known-empty.
 */
export function useFileTreeView(
  username: string,
  view: FileTreeView,
  entryFilter?: FileTreeEntryFilter,
): FileTreeViewState {
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const key = JSON.stringify([username, view, entryFilter ?? null]);
  // Callers pass object literals; the serialized key keeps the reads per change of content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => ({ view, entryFilter }), [key]);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; state: FileTreeViewState } | null>(null);

  useEffect(() => {
    if (!username) return undefined;
    const reread = () => setVersion((value) => value + 1);
    const offDrive = subscribeDriveRemoteChanges(username, reread);
    const offStars = subscribeStarredPathsChanged(username, reread);
    return () => {
      offDrive();
      offStars();
    };
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    let current = true;
    void queryFileTreeView(username, stable.view, stable.entryFilter, online).then(
      (next) => {
        if (current) setResult({ key, state: { ...next, settled: true } });
      },
      () => {
        if (!current) return;
        // A failed re-read keeps the list on screen. With nothing shown yet, an
        // unreadable cache is not-available: never empty, never a spinner no sync ends.
        setResult((previous) =>
          previous?.key === key
            ? previous
            : { key, state: { rows: [], status: "not-available", settled: true } },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [username, key, stable, online, version]);

  return result?.key === key ? result.state : UNSETTLED;
}
