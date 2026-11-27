import { useCallback, useEffect, useMemo, useState } from "react";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveShareOperations } from "@/lib/files/drive-types";
import type { DocsHomeFetcher } from "@/lib/files/docs-home-listing";
import { fetchWgwUnifiedSearch } from "@/lib/api/wgw/search";
import { useFileTreeView } from "@/lib/files/tree-view/use-file-tree-view";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import type { DriveViewState } from "@/drive-core/src/use-drive-tree-rows";
import type { FileWorkspaceConfig } from "@/drive-core/src/file-workspace-config";
import type { DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { docsFilesFromTreeEntries } from "@/docs-core/src/docs-home-tree-rows";
import {
  docsHomeViewSearchesContent,
  useDocsHomeServerRows,
} from "@/docs-core/src/use-docs-home-server-rows";

export type UseDocsHomeRowsArgs = {
  config: FileWorkspaceConfig<DocsHomeView>;
  /** The account whose local tree Docs home lists; null without one (mocks). */
  treeUsername: string | null;
  username: string;
  view: DocsHomeView;
  /** The search box as typed. */
  query: string;
  online: boolean;
  personalDriveLabel: string;
  groupRoots?: readonly DocsHomeGroupRoot[];
  /** Content search, and every list of a mock without a tree. Defaults to the live client. */
  fetcher?: DocsHomeFetcher;
  /** Mock lists only: Starred and Trash. */
  operations?: DriveAPIOperations;
  /** Mock lists only: Shared with me. */
  shareOperations?: DriveShareOperations;
  debounceMs?: number;
};

export type DocsHomeRows = {
  files: DriveFile[];
  /** What the pane shows instead of rows; null shows the rows or the empty state. */
  viewState: DriveViewState;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  /** Read the list again (the tree in every tab, or the server listing). */
  reload: () => void;
  /** The rows come from the device while it is offline. */
  isOfflineListing: boolean;
};

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(() => value.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The rows of one Docs home view (#2063 C4). The live app reads the device's
 * file tree through the Docs workspace config, warm and offline alike, and
 * sends no listing request; only a content search (a query in All Docs,
 * Recent or a drive, online) asks the server. Offline that query filters names
 * on the device. Without a tree (mocks) every view lists from the server.
 */
export function useDocsHomeRows({
  config,
  treeUsername,
  username,
  view,
  query,
  online,
  personalDriveLabel,
  groupRoots,
  fetcher = fetchWgwUnifiedSearch,
  operations,
  shareOperations,
  debounceMs = 300,
}: UseDocsHomeRowsArgs): DocsHomeRows {
  const debouncedQuery = useDebounced(query, debounceMs);
  const hasTree = Boolean(treeUsername);
  const contentSearch =
    Boolean(debouncedQuery) && docsHomeViewSearchesContent(view) && (online || !hasTree);
  const readsTree = hasTree && !contentSearch;

  const tree = useMemo(() => config.treeView(view), [config, view]);
  const entryFilter = useMemo(
    () => (query.trim() ? { ...config.entryFilter, nameQuery: query.trim() } : config.entryFilter),
    [config.entryFilter, query],
  );
  const state = useFileTreeView(readsTree ? (treeUsername ?? "") : "", tree, entryFilter);

  const server = useDocsHomeServerRows({
    enabled: !readsTree,
    searchOnly: hasTree,
    username,
    view,
    query: debouncedQuery,
    fetcher,
    operations,
    shareOperations,
    personalDriveLabel,
    groupRoots,
  });

  const groupRootsKey = groupRoots?.map((root) => `${root.slug}\0${root.label}`).join("\n") ?? "";
  const treeFiles = useMemo(
    () =>
      readsTree && state.settled
        ? docsFilesFromTreeEntries(state.rows, tree, username, { personalDriveLabel, groupRoots })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groupRootsKey tracks slug/label content
    [readsTree, state.rows, state.settled, tree, username, personalDriveLabel, groupRootsKey],
  );

  const reloadServer = server.reload;
  const reload = useCallback(() => {
    if (readsTree && treeUsername) notifyDriveRemoteChange(treeUsername);
    else reloadServer();
  }, [readsTree, reloadServer, treeUsername]);

  if (!readsTree) {
    return {
      files: server.files,
      viewState: null,
      loading: server.loading,
      loadingMore: server.loadingMore,
      hasMore: server.hasMore,
      error: server.error,
      loadMore: server.loadMore,
      reload,
      isOfflineListing: false,
    };
  }

  let viewState: DriveViewState = null;
  if (!state.settled) viewState = "pending";
  else if (state.rows.length === 0 && state.status !== "ready") viewState = state.status;
  return {
    files: treeFiles,
    viewState,
    loading: viewState === "first-sync",
    loadingMore: false,
    hasMore: false,
    error: null,
    loadMore: () => undefined,
    reload,
    isOfflineListing: !online,
  };
}
