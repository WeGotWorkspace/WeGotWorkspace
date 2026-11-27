import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { buildDriveViewBreadcrumbs } from "@/drive-core/src/drive-breadcrumbs";
import {
  applyDriveGroupDisplayNames,
  buildDriveFolderPickerRootLabels,
  collectDriveGroupRoots,
  fetchDriveGroupRoots,
  mergeDriveGroupRoots,
  type DriveGroupRoot,
} from "@/drive-core/src/drive-group-roots";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import { useDriveServerFolder } from "@/drive-core/src/use-drive-server-folder";
import { useDriveTreeRows, type DriveViewState } from "@/drive-core/src/use-drive-tree-rows";
import { useDriveUploadListingRefresh } from "@/drive-core/src/use-drive-upload-listing-refresh";
import {
  DRIVE_TRASH_UI_PATH,
  normalizeDriveFolderUiPath,
  uiPathFromApiPath,
  driveGroupUiPath,
} from "@/lib/files/drive-path-utils";
import { isDriveUnderTrash } from "@/drive-core/src/drive-visible-items";
import { mapDriveListingEntries } from "@/drive-core/src/drive-batch-utils";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import { driveStarredPathMap } from "@/drive-core/src/drive-starred-listing";
import { useConnectivity } from "@/hooks/use-connectivity";
import type {
  DriveAPIOperations,
  DriveShareOperations,
  DriveUIData,
} from "@/lib/files/drive-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { useTeamDisplayNames } from "@/lib/files/team-labels/use-team-display-names";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";

export type UseDriveShellArgs = {
  data: DriveUIData;
  session: WorkspaceSession;
  operations?: DriveAPIOperations;
  shareOperations?: DriveShareOperations;
  listLoading?: boolean;
  /**
   * The device's remembered account (localStorage). While the bootstrap is
   * still loading, `data` has no username yet; the local tree reads with this
   * one so a cold open shows the stored rows at once, never a loading pane.
   */
  offlineUsername?: string | null;
  view?: ViewKey;
  onViewChange?: (view: ViewKey) => void;
};

/** The signed-in username Drive maps paths with. */
export function driveCurrentUsername(data: DriveUIData, session: WorkspaceSession): string {
  return data.user.username || session.user.username || "";
}

export function useDriveShell({
  data,
  session,
  operations,
  listLoading = false,
  offlineUsername = null,
  view: controlledView,
  onViewChange,
}: UseDriveShellArgs) {
  const { showError } = useAppToast();
  /** Members read every view from the device's file tree; guests and mocks have none. */
  const treeEnabled = operations?.localTree === true;
  const currentUsername =
    driveCurrentUsername(data, session) || (treeEnabled ? (offlineUsername ?? "") : "");
  const [files, setFiles] = useState<DriveFile[]>(() => {
    if (!operations) return DRIVE_MOCK_FILES;
    return mapDriveListingEntries(data, currentUsername);
  });
  const [internalView, setInternalView] = useState<ViewKey>({ type: "all" });
  const isViewControlled = onViewChange !== undefined;
  const view = controlledView ?? internalView;
  const commitView = useCallback(
    (next: ViewKey) => {
      const normalized =
        next.type === "folder" ? { ...next, path: normalizeDriveFolderUiPath(next.path) } : next;
      if (isViewControlled) onViewChange!(normalized);
      else setInternalView(normalized);
    },
    [isViewControlled, onViewChange],
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [liveSearchResults, setLiveSearchResults] = useState<DriveFile[] | null>(null);
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [knownGroupRoots, setKnownGroupRoots] = useState<DriveGroupRoot[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const starredLoadVersionRef = useRef(0);
  const { online } = useConnectivity();

  const folderViewPath = view.type === "folder" ? view.path : null;

  useEffect(() => {
    if (!operations) return;
    const controller = new AbortController();
    void fetchDriveGroupRoots(operations, { signal: controller.signal }).then((discovered) => {
      if (discovered.length === 0) return;
      setKnownGroupRoots((prev) => mergeDriveGroupRoots(prev, discovered));
    });
    return () => controller.abort();
  }, [operations]);

  // Cached in the meta store, so team drives keep their name offline (#2063).
  const groupDirectory = useTeamDisplayNames(treeEnabled ? currentUsername : null, online);

  useEffect(() => {
    const discovered = collectDriveGroupRoots(files);
    if (discovered.length === 0) return;
    setKnownGroupRoots((prev) => mergeDriveGroupRoots(prev, discovered));
  }, [files]);

  const labeledGroupRoots = useMemo(
    () => applyDriveGroupDisplayNames(knownGroupRoots, groupDirectory),
    [groupDirectory, knownGroupRoots],
  );

  const groupRootNames = useMemo(
    () => new Set(labeledGroupRoots.map((root) => root.slug)),
    [labeledGroupRoots],
  );
  const groupRootNamesRef = useRef(groupRootNames);
  groupRootNamesRef.current = groupRootNames;
  const sidebarGroupPaths = useMemo(
    () => labeledGroupRoots.map((root) => driveGroupUiPath(root.slug)),
    [labeledGroupRoots],
  );
  const sidebarGroupRoots = useMemo(
    () =>
      labeledGroupRoots.map((root) => ({
        path: driveGroupUiPath(root.slug),
        label: root.label,
      })),
    [labeledGroupRoots],
  );
  const folderPickerRootLabels = useMemo(
    () => buildDriveFolderPickerRootLabels(labeledGroupRoots, driveLabels.sidebarMyDrive),
    [labeledGroupRoots],
  );

  // The boot listing: guests and mocks paint it; an uncontrolled shell opens its folder.
  const bootFolderPath =
    operations && !listLoading && currentUsername.trim()
      ? uiPathFromApiPath(data.cwd, currentUsername)
      : null;
  // Latest values: a caller's fresh callback each render must not repaint the boot listing.
  const bootViewRef = useRef({ commitView, isViewControlled, inFolder: folderViewPath !== null });
  bootViewRef.current = { commitView, isViewControlled, inFolder: folderViewPath !== null };
  useEffect(() => {
    if (!operations || bootFolderPath === null) return;
    if (!treeEnabled) setFiles(mapDriveListingEntries(data, currentUsername));
    const latest = bootViewRef.current;
    if (!latest.isViewControlled && latest.inFolder) {
      latest.commitView({ type: "folder", path: bootFolderPath });
    }
  }, [bootFolderPath, currentUsername, data, operations, treeEnabled]);

  const serverFolder = useDriveServerFolder({
    enabled: !treeEnabled,
    operations,
    folderViewPath,
    currentUsername,
    groupRootNames,
    setFiles,
    commitView,
    showError,
    bootFolderPath,
  });

  useDriveUploadListingRefresh({
    operations,
    folderViewPath,
    currentUsername,
    groupRootNamesRef,
    setFiles,
    listing: data,
  });

  const searchText = searchQuery.trim();
  const treeRows = useDriveTreeRows({
    enabled: treeEnabled,
    view,
    currentUsername,
    groupRootNames,
    rootLabels: folderPickerRootLabels,
    offlineSearchQuery: online ? "" : searchText,
    online,
    setFiles,
  });

  const selectView = useCallback(
    (v: ViewKey) => {
      commitView(v);
      setLiveSearchResults(null);
      dismissSidebarOverlay(() => setSidebarOpen(false));
    },
    [commitView],
  );

  const reloadStarredFromServer = useCallback(() => {
    if (!operations) return;
    const requestVersion = starredLoadVersionRef.current + 1;
    starredLoadVersionRef.current = requestVersion;
    // The hybrid operations store the star set on the device; the Starred view reads it there.
    void operations
      .listStars()
      .then((paths) => {
        if (requestVersion !== starredLoadVersionRef.current) return;
        setStarred(driveStarredPathMap(paths));
      })
      .catch((error: unknown) => {
        if (requestVersion !== starredLoadVersionRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });
  }, [operations, showError]);

  const viewKey = JSON.stringify(view);
  // Online search stays a server call (content search); offline the tree filters names.
  const serverSearch = Boolean(operations) && !(treeEnabled && !online);
  useEffect(() => {
    if (!operations || !serverSearch) {
      setLiveSearchResults(null);
      return;
    }
    const query = searchText;
    if (!query) {
      setLiveSearchResults(null);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void operations
        .search(query, { limit: 100 })
        .then((entries) => {
          if (!cancelled) {
            setLiveSearchResults(
              entries.map((entry) => driveFileFromEntry(entry, currentUsername)),
            );
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
    // A view change clears the results: search again so the new view settles.
  }, [operations, serverSearch, searchText, currentUsername, showError, viewKey]);

  useEffect(() => {
    if (!operations) return;
    if ((data.user.role as string) === "guest") {
      setStarred((previous) => (Object.keys(previous).length === 0 ? previous : {}));
      return;
    }
    reloadStarredFromServer();
  }, [data.user.role, operations, currentUsername, reloadStarredFromServer]);

  const inTrashView = view.type === "folder" && view.path === DRIVE_TRASH_UI_PATH;
  const isUnderTrash = isDriveUnderTrash;

  // What the pane shows instead of rows (`DriveViewState`); null shows the empty
  // state. A search that is not ready never reads as "no hits".
  const serverFolderState: DriveViewState = serverFolder.failed
    ? "error"
    : (listLoading && view.type === "folder") || serverFolder.pending
      ? "first-sync"
      : null;
  // A view the tree serves never takes the server listing's state: its rows
  // (null) must not turn into a loading pane while the bootstrap still loads.
  const ownState: DriveViewState = treeRows.treeActive ? treeRows.viewState : serverFolderState;
  // An online search shows the view's own state until the server answers: a
  // pending or failed search never reads as "no hits".
  const searchState: DriveViewState = serverSearch
    ? liveSearchResults === null
      ? (ownState ?? "pending")
      : null
    : treeRows.offlineSearchState;
  const viewState: DriveViewState = searchText ? searchState : ownState;

  const breadcrumbs = useMemo(
    () => buildDriveViewBreadcrumbs(view, driveLabels, folderPickerRootLabels),
    [folderPickerRootLabels, view],
  );

  const viewLabel = breadcrumbs[breadcrumbs.length - 1].label;
  const viewResetKey =
    view.type === "folder"
      ? `${view.type}:${view.path}`
      : view.type === "access"
        ? `access:${view.scopePath ?? ""}`
        : view.type;

  return {
    labels: driveLabels,
    currentUsername,
    files,
    setFiles,
    view,
    setView: commitView,
    commitView,
    selectView,
    sidebarOpen,
    setSidebarOpen,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    liveSearchResults: treeRows.offlineSearchResults ?? liveSearchResults,
    starred,
    setStarred,
    /** Rows of the flat views (All Files, Recent, Starred, Shared) from the tree; null otherwise. */
    viewItems: treeRows.viewItems,
    /** A write shows on the flat views at once; the next read of the tree replaces it. */
    patchAllFiles: treeRows.patchViewItems,
    treeActive: treeRows.treeActive,
    knownGroupRoots,
    groupRootNames,
    sidebarGroupPaths,
    sidebarGroupRoots,
    folderPickerRootLabels,
    breadcrumbs,
    viewLabel,
    viewResetKey,
    viewState,
    /** Try the failed server folder listing again (sessions without a local tree). */
    retryFolder: serverFolder.retry,
    inTrashView,
    isUnderTrash,
    listLoading,
    operations,
    data,
    reloadStarredFromServer,
  };
}

export type DriveShellState = ReturnType<typeof useDriveShell>;
