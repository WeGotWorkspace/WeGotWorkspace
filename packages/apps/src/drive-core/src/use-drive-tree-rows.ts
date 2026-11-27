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
import type { FileTreeViewStatus } from "@/lib/files/tree-view/tree-view-query";
import { useFileTreeView, type FileTreeViewState } from "@/lib/files/tree-view/use-file-tree-view";
import { readDriveFirstPassDone } from "@/lib/offline/drive/drive-first-sync-retry";

/** What the pane shows instead of rows. `null`: the rows (or the empty state). */
export type DriveViewState =
  /** The first read of this view has not answered yet: show nothing, neither empty nor loading. */
  | "pending"
  /** First sync on this device, nothing arrived for this view yet: full-pane loading. */
  | "first-sync"
  /** Offline before the first sync: "not available offline yet", with how to fix it. Never empty. */
  | "not-available"
  /** Offline after the first sync, a folder the tree does not hold: "not available offline yet". */
  | "not-synced"
  /** Online after the first sync, a folder the tree does not hold: it is not here (any more). */
  | "missing"
  /** A server folder listing failed (sessions without a local tree): error with Try again. */
  | "error"
  | null;

/**
 * The pane state of a tree read with no rows that is not `ready`. `firstSyncDone`
 * is null until it has been read; the pane shows nothing until then.
 */
function emptyReadState(
  status: FileTreeViewStatus,
  firstSyncDone: boolean | null,
  online: boolean,
): DriveViewState {
  if (status === "first-sync") return "first-sync";
  if (firstSyncDone === null) return "pending";
  if (!firstSyncDone) return "not-available";
  return online ? "missing" : "not-synced";
}

const IDLE_VIEW: FileTreeView = { kind: "all" };
const NO_ROWS: DriveFile[] = [];

function isNotAvailable(read: FileTreeViewState): boolean {
  return read.settled && read.rows.length === 0 && read.status === "not-available";
}
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
  online: boolean;
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
  online,
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
  // A flat view lists only its own rows: none while its read is pending, never another view's.
  const flatRows = tree && !isFolderTree ? (treeFiles ?? NO_ROWS) : null;
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

  // "Not available" reads differently before and after the first sync on this device.
  const searching = Boolean(username && offlineSearchQuery);
  const askFirstSync =
    (tree !== null && isNotAvailable(state)) || (searching && isNotAvailable(search));
  const [firstSync, setFirstSync] = useState<{ username: string; done: boolean } | null>(null);
  useEffect(() => {
    if (!askFirstSync) return undefined;
    let current = true;
    void readDriveFirstPassDone(username).then((done) => {
      if (current) setFirstSync({ username, done });
    });
    return () => {
      current = false;
    };
  }, [askFirstSync, username, state, search]);
  const firstSyncDone = firstSync?.username === username ? firstSync.done : null;

  const readState = (read: FileTreeViewState): DriveViewState => {
    if (!read.settled) return "pending";
    if (read.rows.length > 0 || read.status === "ready") return null;
    return emptyReadState(read.status, firstSyncDone, online);
  };

  return {
    /** The open view reads the local tree. */
    treeActive: tree !== null,
    viewItems,
    patchViewItems,
    viewState: tree ? readState(state) : null,
    /** Offline search hits from the tree; null online or without a query. */
    offlineSearchResults: searchResults,
    /** The pane state of the offline search: not ready is never "no hits". */
    offlineSearchState: searching ? readState(search) : null,
  };
}
