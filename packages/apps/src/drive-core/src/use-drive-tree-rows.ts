import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  driveFilesFromTreeEntries,
  driveTreeViewFor,
  type DriveAllFilesPatch,
} from "@/drive-core/src/drive-view-rows";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import { useFileTreeView } from "@/lib/files/tree-view/use-file-tree-view";

/** What the pane shows instead of rows. `null`: the rows (or the empty state). */
export type DriveViewState =
  /** The first read of this view has not answered yet: show nothing, neither empty nor loading. */
  | "pending"
  /** First sync on this device, nothing arrived for this view yet: full-pane loading. */
  | "first-sync"
  /** Offline before this view synced: "not available offline yet", never empty. */
  | "not-available"
  | null;

const IDLE_VIEW: FileTreeView = { kind: "all" };
/** Offline search: every file of the tree, narrowed by name on the device. */
const OFFLINE_SEARCH_VIEW: FileTreeView = { kind: "prefix", path: "" };

export type UseDriveTreeRowsArgs = {
  /** False for guests and mocks: they have no local tree. */
  enabled: boolean;
  view: ViewKey;
  currentUsername: string;
  groupRootNames: Set<string>;
  rootLabels: Readonly<Record<string, string>>;
  /** Offline search query; empty online (online search stays a server call). */
  offlineSearchQuery: string;
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
};

/**
 * Every Drive view on the local file tree (#2063 C3). Folder and Trash rows
 * go into `files`, where writes patch them at once; the flat views (All Files,
 * Recent, Starred, Shared) come back as `viewItems`, which `patchViewItems`
 * changes until the next read of the tree. Both re-read when the Drive cache
 * changes in any tab. Nothing here sends a request.
 */
export function useDriveTreeRows({
  enabled,
  view,
  currentUsername,
  groupRootNames,
  rootLabels,
  offlineSearchQuery,
  setFiles,
}: UseDriveTreeRowsArgs) {
  const username = enabled ? currentUsername.trim() : "";
  const tree = useMemo(
    () => (username ? driveTreeViewFor(view, username, groupRootNames) : null),
    [groupRootNames, username, view],
  );
  const state = useFileTreeView(tree ? username : "", tree ?? IDLE_VIEW);
  const search = useFileTreeView(
    username && offlineSearchQuery ? username : "",
    OFFLINE_SEARCH_VIEW,
    { nameQuery: offlineSearchQuery },
  );

  const treeFiles = useMemo(
    () =>
      tree && state.settled
        ? driveFilesFromTreeEntries(state.rows, tree, username, rootLabels)
        : null,
    [rootLabels, state.rows, state.settled, tree, username],
  );

  const isFolderTree = tree?.kind === "folder" || tree?.kind === "trash";
  const folderUiPath = view.type === "folder" ? view.path : null;

  // Folder rows replace the folder's rows in `files`. A row the tree does not
  // hold yet and that has no server path (a new folder on its way) stays.
  useEffect(() => {
    if (!isFolderTree || !treeFiles || folderUiPath === null) return;
    const treeIds = new Set(treeFiles.map((file) => file.id));
    setFiles((previous) => [
      ...treeFiles,
      ...previous.filter(
        (file) => file.parent === folderUiPath && !file.apiPath && !treeIds.has(file.id),
      ),
    ]);
  }, [folderUiPath, isFolderTree, setFiles, treeFiles]);

  // Flat views: a write patches the rows at once; the next read of the tree replaces the patch.
  const [patched, setPatched] = useState<{ source: DriveFile[]; rows: DriveFile[] } | null>(null);
  const treeFilesRef = useRef(treeFiles);
  treeFilesRef.current = treeFiles;
  const flatRows = !isFolderTree ? treeFiles : null;
  const viewItems = flatRows && patched?.source === flatRows ? patched.rows : flatRows;
  const patchViewItems = useCallback<DriveAllFilesPatch>((update) => {
    setPatched((previous) => {
      const source = treeFilesRef.current;
      if (!source) return previous;
      const base = previous?.source === source ? previous.rows : source;
      return { source, rows: update(base) };
    });
  }, []);

  const searchResults = useMemo(
    () =>
      username && offlineSearchQuery && search.settled
        ? driveFilesFromTreeEntries(search.rows, OFFLINE_SEARCH_VIEW, username, rootLabels)
        : null,
    [offlineSearchQuery, rootLabels, search.rows, search.settled, username],
  );

  let viewState: DriveViewState = null;
  if (tree) {
    if (!state.settled) viewState = "pending";
    else if (state.rows.length === 0 && state.status !== "ready") viewState = state.status;
  }

  return {
    /** The open view reads the local tree. */
    treeActive: tree !== null,
    viewItems,
    patchViewItems,
    viewState,
    /** Offline search hits from the tree; null online or without a query. */
    offlineSearchResults: searchResults,
  };
}
