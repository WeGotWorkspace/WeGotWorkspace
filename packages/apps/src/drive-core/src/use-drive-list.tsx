import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedDriveViewMode } from "@/drive-core/src/use-persisted-drive-view-mode";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useSelectionResetOnKeyChange } from "@/hooks/use-selection-reset-on-key-change";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import { findDrivePluginForExtension } from "@/drive-core/src/drive-plugin-utils";
import { filterDriveVisibleItems } from "@/drive-core/src/drive-visible-items";
import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";
import { useDriveGridPreviews } from "@/drive-core/src/use-drive-grid-previews";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { isDocsEditorPreviewFile } from "@/lib/file-preview/file-preview-utils";

const WRITE_QUEUE_DELAY_MS = 2500;

export type UseDriveListArgs = {
  shell: DriveShellState;
  onOpenDocsFile?: (apiPath: string) => void;
};

export function useDriveList({ shell, onOpenDocsFile }: UseDriveListArgs) {
  const {
    files,
    setFiles,
    liveSearchResults,
    starredItems,
    sharedItems,
    starred,
    view,
    searchQuery,
    currentUsername,
    operations,
    viewResetKey,
    selectView,
    data,
    ensurePluginSessionBeforeNavigate,
  } = shell;

  const { showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not sync this change. Please try again.") => showError(fallback),
    [showError],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewMode, setViewMode] = usePersistedDriveViewMode("grid");
  const recentOpenRef = useRef<{ key: string; at: number } | null>(null);
  const isTouch = useIsTouch();
  const lastTouchTapRef = useRef<{ id: string; at: number } | null>(null);

  const visibleItems = useMemo(
    () =>
      filterDriveVisibleItems({
        files,
        liveSearchResults,
        starredItems,
        sharedItems,
        starred,
        view,
        searchQuery,
        currentUsername,
        operations,
      }),
    [
      currentUsername,
      files,
      liveSearchResults,
      operations,
      searchQuery,
      sharedItems,
      starred,
      starredItems,
      view,
    ],
  );

  const visibleIds = useMemo(() => visibleItems.map((file) => file.id), [visibleItems]);

  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect: listHandleSelect,
    enterSelectionFor,
    exitSelection,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  } = useWorkspaceListController<DriveFile>({
    items: files,
    setItems: setFiles,
    visibleIds,
    activeId: activeId ?? "",
    setActiveId: (id) => setActiveId(id),
    onPrimarySelect: (id) => setActiveId(id),
    onMutationError: showMutationError,
    queueDelayMs: WRITE_QUEUE_DELAY_MS,
  });

  useSelectionResetOnKeyChange({
    resetKey: viewResetKey,
    setSelectedIds,
    setSelectionMode,
  });

  useEffect(() => {
    setActiveId(null);
    setDetailOpen(false);
    lastTouchTapRef.current = null;
  }, [viewResetKey]);

  const active = activeId
    ? ((liveSearchResults?.find((f) => f.id === activeId) ??
        files.find((f) => f.id === activeId) ??
        null) as DriveFile | null)
    : null;

  const detailPreviewFile = active && (detailOpen || viewMode === "list") ? active : null;

  const { filePreviews, richPreviews } = useDriveGridPreviews({
    items: visibleItems,
    operations,
    enabled: viewMode === "grid" || detailOpen,
    extraFile: detailPreviewFile,
  });

  const openFile = (f: DriveFile) => {
    const openKey = f.apiPath ?? `${f.parent}/${f.title}`;
    const now = Date.now();
    const recent = recentOpenRef.current;
    if (recent && recent.key === openKey && now - recent.at < 700) {
      return;
    }
    recentOpenRef.current = { key: openKey, at: now };

    if (f.kind === "folder") {
      if (f.apiPath) {
        selectView({ type: "folder", path: uiPathFromApiPath(f.apiPath, currentUsername) });
      } else {
        const next = f.parent === "" ? f.title : `${f.parent}/${f.title}`;
        selectView({ type: "folder", path: next });
      }
      return;
    }

    const ext = extensionFromFileName(f.title);

    if (
      f.apiPath &&
      onOpenDocsFile &&
      (isDocsEditorPreviewFile(f.title, f.apiPath) || isDocsCollabEditablePath(f.apiPath))
    ) {
      onOpenDocsFile(f.apiPath);
      return;
    }

    if (f.apiPath) {
      const plugin = findDrivePluginForExtension(data.plugins, ext);
      if (plugin?.drive?.openFileRoute && plugin.drive.openFileQueryParam) {
        const rel = f.apiPath.replace(/^\/+/, "");
        const qp = new URLSearchParams({ [plugin.drive.openFileQueryParam]: rel });
        const target = `${plugin.drive.openFileRoute}?${qp.toString()}`;
        ensurePluginSessionBeforeNavigate(plugin.integration?.sessionApiPath, () => {
          window.open(target, "_blank", "noopener,noreferrer");
        });
        return;
      }
    }

    setActiveId(f.id);
    setSelectedIds([f.id]);
    setDetailOpen(true);
  };

  const openDocsEditorFile = useCallback(
    (f: DriveFile) => {
      if (f.apiPath && onOpenDocsFile && isDocsEditorPreviewFile(f.title, f.apiPath)) {
        onOpenDocsFile(f.apiPath);
      }
    },
    [onOpenDocsFile],
  );

  const handleSelect = useCallback(
    (id: string, e: ReactMouseEvent) => {
      if (isTouch && !selectionMode && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const now = Date.now();
        const lastTap = lastTouchTapRef.current;
        if (lastTap && lastTap.id === id && now - lastTap.at < 350) {
          const tappedItem = visibleItems.find((file) => file.id === id);
          if (tappedItem) {
            lastTouchTapRef.current = null;
            openFile(tappedItem);
            return;
          }
        }
        lastTouchTapRef.current = { id, at: now };
      } else if (!isTouch) {
        lastTouchTapRef.current = null;
      }
      listHandleSelect(id, e);
    },
    [isTouch, listHandleSelect, openFile, selectionMode, visibleItems],
  );

  const fileById = (id: string) =>
    (liveSearchResults?.find((file) => file.id === id) ?? files.find((file) => file.id === id)) ||
    null;

  const dropZoneProps = sidebarDropZoneProps;

  return {
    activeId,
    setActiveId,
    selectedIds,
    setSelectedIds,
    detailOpen,
    setDetailOpen,
    selectionMode,
    setSelectionMode,
    viewMode,
    setViewMode,
    visibleItems,
    active,
    filePreviews,
    richPreviews,
    isTouch,
    openFile,
    openDocsEditorFile,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    fileById,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    dropZoneProps,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  };
}

export type DriveListState = ReturnType<typeof useDriveList>;
