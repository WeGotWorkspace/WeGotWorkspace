import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { buildDriveFolderBreadcrumbs } from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels, driveOfficeNewFileLabel } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import { mergeDriveFolderListing } from "@/drive-core/src/drive-batch-utils";
import { findDrivePluginWithTemplates } from "@/drive-core/src/drive-plugin-utils";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_UI_PATH,
  normalizeDriveFolderUiPath,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";
import { isDriveUnderTrash } from "@/drive-core/src/drive-visible-items";
import {
  driveFileFromSharedWithMeEntry,
  driveFileFromEntry,
} from "@/drive-core/src/drive-file-utils";
import type {
  DriveAPIOperations,
  DriveShareOperations,
  DriveUIData,
  DriveUnifiedSearchResult,
  WgwPluginDescriptor,
} from "@/drive-core/src/drive-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import {
  apiPathFromSearchSourceKey,
  driveFileFromSearchResult,
  parentVirtualPath,
} from "@/drive-core/src/drive-search-utils";

export type UseDriveShellArgs = {
  data: DriveUIData;
  session: WorkspaceSession;
  operations?: DriveAPIOperations;
  shareOperations?: DriveShareOperations;
  listLoading?: boolean;
  view?: ViewKey;
  onViewChange?: (view: ViewKey) => void;
  onNavigate?: (href: string) => void;
};

export type DriveShellOpenFileHandler = (file: DriveFile) => void;

export type DriveShellSelectionHandlers = {
  setActiveId: (id: string | null) => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setDetailOpen: (open: boolean) => void;
};

export function useDriveShell({
  data,
  session,
  operations,
  shareOperations,
  listLoading = false,
  view: controlledView,
  onViewChange,
  onNavigate,
}: UseDriveShellArgs) {
  const { showError } = useAppToast();

  const ensurePluginSessionBeforeNavigate = useCallback(
    (sessionPath: string | undefined, navigate: () => void) => {
      const ensureSession =
        sessionPath && operations?.ensurePluginSession
          ? operations.ensurePluginSession(sessionPath)
          : Promise.resolve();
      void ensureSession
        .then(() => {
          navigate();
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : undefined;
          showError("Could not open app", { description: detail });
        });
    },
    [operations, showError],
  );

  const launchPluginEditor = useCallback(
    (plugin: WgwPluginDescriptor, route: string, params: URLSearchParams) => {
      const target = `${route}?${params.toString()}`;
      ensurePluginSessionBeforeNavigate(plugin.integration?.sessionApiPath, () => {
        onNavigate?.(target);
      });
    },
    [ensurePluginSessionBeforeNavigate, onNavigate],
  );

  const templatePlugin = useMemo(() => findDrivePluginWithTemplates(data.plugins), [data.plugins]);
  const newFileTemplates = useMemo(() => {
    if (!templatePlugin?.drive?.newFileTemplates) return [];
    return templatePlugin.drive.newFileTemplates
      .filter((template) => ["doc", "sheet", "slides"].includes(template.kind))
      .map((template) => ({
        id: template.id,
        label: driveOfficeNewFileLabel(template.kind),
        kind: template.kind,
        queryValue: template.queryValue,
      }));
  }, [templatePlugin]);

  const currentUsername = data.user.username || session.user.username || "";
  const [files, setFiles] = useState<DriveFile[]>(() => {
    if (!operations) return DRIVE_MOCK_FILES;
    if (data.directory.files.length === 0) return [];
    return data.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername));
  });
  const [internalView, setInternalView] = useState<ViewKey>({ type: "folder", path: "My Drive" });
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
  const [starredItems, setStarredItems] = useState<DriveFile[] | null>(null);
  const [sharedItems, setSharedItems] = useState<DriveFile[] | null>(null);
  const [knownGroupRoots, setKnownGroupRoots] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const syncedFolderPathRef = useRef<string | null>(null);
  const pendingFolderRefetchRef = useRef(false);
  const starredLoadVersionRef = useRef(0);
  const sharedLoadVersionRef = useRef(0);
  const [hydratedFolderPath, setHydratedFolderPath] = useState<string | null>(null);

  const folderViewPath = view.type === "folder" ? view.path : null;

  useLayoutEffect(() => {
    if (!operations || folderViewPath === null || listLoading || !currentUsername.trim()) {
      return;
    }
    const cwdUi = uiPathFromApiPath(data.cwd, currentUsername);
    if (folderViewPath !== cwdUi) {
      return;
    }
    if (pendingFolderRefetchRef.current) {
      return;
    }
    syncedFolderPathRef.current = folderViewPath;
    setHydratedFolderPath(folderViewPath);
  }, [currentUsername, data.cwd, folderViewPath, listLoading, operations]);

  useEffect(() => {
    const discovered = new Set<string>();
    for (const file of files) {
      if (!file.apiPath || !file.apiPath.startsWith("/groups/")) continue;
      const relative = file.apiPath.slice("/groups/".length);
      const [root] = relative.split("/");
      if (root) discovered.add(root);
    }
    if (discovered.size === 0) return;
    setKnownGroupRoots((prev) => {
      const next = new Set(prev);
      discovered.forEach((root) => next.add(root));
      return Array.from(next).sort((a, b) => a.localeCompare(b));
    });
  }, [files]);

  const groupRootNames = useMemo(() => new Set(knownGroupRoots), [knownGroupRoots]);
  const groupRootNamesRef = useRef(groupRootNames);
  groupRootNamesRef.current = groupRootNames;
  const sidebarGroupPaths = useMemo(
    () => knownGroupRoots.map((root) => `Groups/${root}`),
    [knownGroupRoots],
  );

  useEffect(() => {
    if (!operations || listLoading || !currentUsername.trim()) return;
    if (folderViewPath === null || pendingFolderRefetchRef.current) return;
    const cwdPath = uiPathFromApiPath(data.cwd, currentUsername);
    if (isViewControlled && folderViewPath !== cwdPath) {
      return;
    }
    setFiles(data.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)));
    syncedFolderPathRef.current = folderViewPath ?? cwdPath;
    setHydratedFolderPath(cwdPath);
    if (!isViewControlled) {
      commitView({ type: "folder", path: cwdPath });
    }
  }, [
    commitView,
    currentUsername,
    data,
    folderViewPath,
    isViewControlled,
    listLoading,
    operations,
  ]);

  useEffect(() => {
    if (!operations || folderViewPath === null || listLoading || !currentUsername.trim()) {
      return;
    }
    if (syncedFolderPathRef.current === folderViewPath) {
      setHydratedFolderPath(folderViewPath);
      return;
    }

    const controller = new AbortController();
    void operations
      .changeDir(apiPathFromUiPath(folderViewPath, currentUsername, groupRootNamesRef.current), {
        signal: controller.signal,
      })
      .then((nextData) => {
        const resolvedPath = uiPathFromApiPath(nextData.cwd, currentUsername);
        pendingFolderRefetchRef.current = false;
        syncedFolderPathRef.current = resolvedPath;
        setFiles((previous) => mergeDriveFolderListing(previous, nextData, currentUsername));
        setHydratedFolderPath(resolvedPath);
        if (resolvedPath !== folderViewPath) {
          commitView({ type: "folder", path: resolvedPath });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        pendingFolderRefetchRef.current = false;
        setHydratedFolderPath(folderViewPath);
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });

    return () => controller.abort();
  }, [commitView, currentUsername, folderViewPath, listLoading, operations, showError]);

  const selectView = useCallback(
    (v: ViewKey) => {
      if (v.type === "folder") {
        pendingFolderRefetchRef.current = true;
        syncedFolderPathRef.current = null;
        setHydratedFolderPath(null);
      }
      commitView(v);
      setLiveSearchResults(null);
      if (isSidebarOverlayViewport()) {
        setSidebarOpen(false);
      }
    },
    [commitView],
  );

  const loadStarredItemsFromPaths = useCallback(
    (paths: string[]) => {
      if (!operations) {
        setStarredItems(null);
        return;
      }
      const requestVersion = starredLoadVersionRef.current + 1;
      starredLoadVersionRef.current = requestVersion;
      if (paths.length === 0) {
        setStarredItems([]);
        return;
      }
      void operations
        .listEntriesByPaths(paths)
        .then((entries) => {
          if (requestVersion !== starredLoadVersionRef.current) return;
          setStarredItems(entries.map((entry) => driveFileFromEntry(entry, currentUsername)));
        })
        .catch((error: unknown) => {
          if (requestVersion !== starredLoadVersionRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
        });
    },
    [operations, currentUsername, showError],
  );

  const reloadStarredFromServer = useCallback(() => {
    if (!operations) return;
    void operations
      .listStars()
      .then((paths) => {
        const next: Record<string, boolean> = {};
        for (const path of paths) {
          next[path] = true;
        }
        setStarred(next);
        loadStarredItemsFromPaths(paths);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });
  }, [operations, loadStarredItemsFromPaths, showError]);

  useEffect(() => {
    if (!operations) return;
    const query = searchQuery.trim();
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
  }, [operations, searchQuery, currentUsername, showError]);

  useEffect(() => {
    if (!operations) {
      setStarredItems(null);
      return;
    }
    if ((data.user.role as string) === "guest") {
      setStarred((previous) => (Object.keys(previous).length === 0 ? previous : {}));
      setStarredItems((previous) => (previous?.length === 0 ? previous : []));
      return;
    }
    reloadStarredFromServer();
  }, [data.user.role, operations, currentUsername, reloadStarredFromServer]);

  useEffect(() => {
    if (!shareOperations) {
      setSharedItems(null);
      return;
    }
    if (view.type !== "shared") return;

    const requestVersion = sharedLoadVersionRef.current + 1;
    sharedLoadVersionRef.current = requestVersion;
    const controller = new AbortController();

    void shareOperations
      .listSharedWithMe({ signal: controller.signal })
      .then((entries) => {
        if (requestVersion !== sharedLoadVersionRef.current) return;
        setSharedItems(
          entries
            .map((entry) => driveFileFromSharedWithMeEntry(entry, currentUsername))
            .filter((file): file is DriveFile => file !== null),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestVersion !== sharedLoadVersionRef.current) return;
        setSharedItems([]);
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });

    return () => {
      controller.abort();
    };
  }, [shareOperations, view.type, currentUsername, showError]);

  const inTrashView = view.type === "folder" && view.path === DRIVE_TRASH_UI_PATH;
  const isUnderTrash = isDriveUnderTrash;

  const folderListingPending = useMemo(() => {
    if (!operations || view.type !== "folder") return false;
    if (listLoading || !currentUsername.trim()) return true;
    return hydratedFolderPath !== view.path;
  }, [currentUsername, hydratedFolderPath, listLoading, operations, view]);

  const breadcrumbs = useMemo(() => {
    if (view.type === "access") {
      return [{ label: driveLabels.accessTitle, path: null as string | null }];
    }
    if (view.type !== "folder") {
      return [
        {
          label:
            view.type === "recent"
              ? driveLabels.sidebarRecent
              : view.type === "starred"
                ? driveLabels.sidebarStarred
                : driveLabels.sidebarSharedWithMe,
          path: null as string | null,
        },
      ];
    }
    return buildDriveFolderBreadcrumbs(view.path, driveLabels);
  }, [view]);

  const viewLabel = breadcrumbs[breadcrumbs.length - 1].label;
  const viewResetKey =
    view.type === "folder"
      ? `${view.type}:${view.path}`
      : view.type === "access"
        ? `access:${view.scopePath ?? ""}`
        : view.type;

  const createUnifiedSearchSelectHandler = useCallback(
    (openFile: DriveShellOpenFileHandler, selection: DriveShellSelectionHandlers) =>
      (result: DriveUnifiedSearchResult) => {
        void (async () => {
          try {
            if (result.sourceType === "caldav" || result.sourceType === "carddav") {
              await operations?.downloadUnifiedSearchRecord?.({
                resultId: result.id,
                sourceType: result.sourceType,
                sourceKey: result.sourceKey,
              });
              return;
            }
            if (result.sourceType === "note") {
              window.open("/notes", "_blank", "noopener,noreferrer");
              return;
            }
            if (result.sourceType !== "file") return;
            const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
            if (!apiPath) return;
            const uiPath = uiPathFromApiPath(apiPath, currentUsername);
            if (result.category === "folder") {
              setSearchQuery("");
              selectView({ type: "folder", path: uiPath });
              return;
            }
            const file = driveFileFromSearchResult(result, uiPath, apiPath, currentUsername);
            if (result.category === "image") {
              selection.setActiveId(file.id);
              selection.setSelectedIds([file.id]);
              selection.setDetailOpen(true);
              return;
            }
            openFile(file);
          } catch {
            const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
            if (!apiPath) return;
            const uiPath = uiPathFromApiPath(apiPath, currentUsername);
            selectView({ type: "folder", path: parentVirtualPath(uiPath) });
          }
        })();
      },
    [currentUsername, operations, selectView],
  );

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
    liveSearchResults,
    starred,
    setStarred,
    starredItems,
    sharedItems,
    knownGroupRoots,
    groupRootNames,
    sidebarGroupPaths,
    breadcrumbs,
    viewLabel,
    viewResetKey,
    folderListingPending,
    inTrashView,
    isUnderTrash,
    listLoading,
    operations,
    data,
    templatePlugin,
    newFileTemplates,
    launchPluginEditor,
    ensurePluginSessionBeforeNavigate,
    reloadStarredFromServer,
    createUnifiedSearchSelectHandler,
  };
}

export type DriveShellState = ReturnType<typeof useDriveShell>;
