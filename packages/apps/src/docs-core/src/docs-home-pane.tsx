import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/button/src/button";
import { CollectionState } from "@/collection-state/src/collection-state";
import { ViewHeader } from "@/view-header/src/view-header";
import { ViewModeToggle, type ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import { DriveGridView, DriveListView } from "@/drive-core/src/drive-browser";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { useDriveSelectionBar } from "@/drive-core/src/use-drive-selection-bar";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import { useDriveGridPreviews } from "@/drive-core/src/use-drive-grid-previews";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import { resolveDriveFileCanManageStructure } from "@/drive-core/src/drive-file-structure-rights";
import { resolveGridFilePreview } from "@/lib/file-preview/file-preview-utils";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import { ShareDialog } from "@/share-ui/share-dialog";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";

/** The home list is server-driven; the controller never mutates items locally. */
const noop = () => {};
const noopUndo = () => false;
const noopSetItems: Dispatch<SetStateAction<DriveFile[]>> = () => {};

export type DocsHomePaneProps = {
  labels: DocsUILabels;
  /** Header title; defaults to `labels.homeTitle`. */
  title?: string;
  /** Empty-state copy; defaults to `labels.homeEmpty`. */
  emptyMessage?: string;
  files: DriveFile[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Row ids with pending offline sync (collab save, outbox, or body hydration). */
  offlinePendingSyncIds?: ReadonlySet<string>;
  offlineLabels?: {
    offlineAvailable: string;
    offlinePendingSync: string;
  };
  query: string;
  onQueryChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onLoadMore: () => void;
  onOpenFile: (file: DriveFile) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Star map keyed by file id. Defaults to empty when actions are not wired. */
  starred?: Record<string, boolean>;
  onStar?: (id: string) => void;
  onDownload?: (file: DriveFile) => void;
  onRename?: (file: DriveFile) => void;
  onMove?: (file: DriveFile) => void;
  onTrash?: (file: DriveFile) => void;
  operations?: DriveAPIOperations;
  batchStar?: (ids: string[]) => void;
  requestMoveSelected?: (ids: string[]) => void;
  requestDeleteSelected?: (ids: string[]) => void;
  /** Undo the latest queued trash mutation (toast or Cmd+Z). */
  onUndoQueuedAction?: () => boolean;
  /** When false, the header search field is hidden (e.g. offline without live search). */
  searchEnabled?: boolean;
  /** When set, enables Share in row action menus (parity with Drive home). */
  shareOperations?: DriveShareOperations;
  /** Current user handle — used for ShareDialog "Manage access" navigation. */
  username?: string;
};

/** Docs home search rows omit `mayShare`; resolve Share visibility for row overflow menus. */
export function resolveDocsHomeFileCanShare({
  shareEnabled,
  apiPath,
  isActive,
  fileMayShare,
  activeMayShare,
}: {
  shareEnabled: boolean;
  apiPath?: string;
  isActive: boolean;
  fileMayShare?: boolean;
  activeMayShare?: boolean;
}): boolean {
  if (!shareEnabled || !apiPath?.trim()) return false;
  const resolvedMayShare = isActive ? activeMayShare : fileMayShare;
  if (resolvedMayShare === false) return false;
  if (resolvedMayShare === true) return true;
  if (isActive) return false;
  return true;
}

export function DocsHomePane({
  labels,
  title,
  emptyMessage,
  files,
  loading,
  loadingMore,
  hasMore,
  error,
  offlinePendingSyncIds,
  offlineLabels,
  query,
  onQueryChange,
  viewMode,
  onViewModeChange,
  onLoadMore,
  onOpenFile,
  sidebarOpen,
  onToggleSidebar,
  starred,
  onStar,
  onDownload,
  onRename,
  onMove,
  onTrash,
  operations,
  batchStar,
  requestMoveSelected,
  requestDeleteSelected,
  onUndoQueuedAction,
  searchEnabled = true,
  shareOperations,
  username = "",
}: DocsHomePaneProps) {
  const filesById = useMemo(() => {
    const map = new Map<string, DriveFile>();
    for (const file of files) map.set(file.id, file);
    return map;
  }, [files]);

  const isTouch = useIsTouch();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastTouchTapRef = useRef<{ id: string; at: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const visibleIds = useMemo(() => files.map((file) => file.id), [files]);

  const { filePreviews, richPreviews } = useDriveGridPreviews({
    items: files,
    operations,
    enabled: viewMode === "grid",
  });

  const gridFilePreviews = useMemo(() => {
    const merged: Record<string, FilePreviewPayload> = {};
    for (const file of files) {
      const resolved = resolveGridFilePreview(filePreviews, richPreviews, file.id);
      if (resolved) merged[file.id] = resolved;
    }
    return merged;
  }, [filePreviews, richPreviews, files]);

  // Reuse Drive's shared list controller so select/drag/keyboard behave identically.
  const {
    selectedIds,
    selectionMode,
    handleSelect: listHandleSelect,
    enterSelectionFor,
    exitSelection,
    isItemDragging,
    itemDragHandlers,
    navigateListByKeyboard,
  } = useWorkspaceListController<DriveFile>({
    items: files,
    setItems: noopSetItems,
    visibleIds,
    activeId: activeId ?? "",
    setActiveId: (id) => setActiveId(id),
    onPrimarySelect: (id) => setActiveId(id),
    onMutationError: noop,
  });

  const openFile = useCallback((file: DriveFile) => onOpenFile(file), [onOpenFile]);

  // Mirror use-drive-list: single click selects; a quick second tap on touch opens.
  const handleSelect = useCallback(
    (id: string, event: ReactMouseEvent) => {
      if (isTouch && !selectionMode && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        const now = Date.now();
        const lastTap = lastTouchTapRef.current;
        if (lastTap && lastTap.id === id && now - lastTap.at < 350) {
          const tapped = filesById.get(id);
          if (tapped) {
            lastTouchTapRef.current = null;
            openFile(tapped);
            return;
          }
        }
        lastTouchTapRef.current = { id, at: now };
      } else if (!isTouch) {
        lastTouchTapRef.current = null;
      }
      listHandleSelect(id, event);
    },
    [filesById, isTouch, listHandleSelect, openFile, selectionMode],
  );

  const requestDeleteSelection = useCallback(() => {
    if (selectedIds.length > 0 && requestDeleteSelected) {
      requestDeleteSelected(selectedIds);
      return;
    }
    if (!onTrash) return;
    const id = activeId;
    const target = id ? filesById.get(id) : undefined;
    if (target) onTrash(target);
  }, [activeId, filesById, onTrash, requestDeleteSelected, selectedIds]);

  const { selectionBar } = useDriveSelectionBar({
    labels: driveLabels,
    files,
    selectedIds,
    selectionMode,
    activeId,
    inTrashView: false,
    operations,
    exitSelection,
    batchStar: () => batchStar?.(selectedIds),
    requestDeleteSelected: () => requestDeleteSelected?.(selectedIds),
    requestMoveSelected: () => requestMoveSelected?.(selectedIds),
  });

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: selectedIds.length,
    onRequestDeleteSelection: requestDeleteSelection,
    onNavigateList: navigateListByKeyboard,
    onUndoQueuedAction: onUndoQueuedAction ?? noopUndo,
  });

  const shareDialog = useDriveShareDialog({ shareOperations, username });
  const activeFile = activeId ? filesById.get(activeId) : undefined;
  const needsActiveRightsFetch = Boolean(
    shareOperations &&
    activeFile?.apiPath &&
    (activeFile.mayShare === undefined || activeFile.mayManageStructure === undefined),
  );
  const { mayShare: fetchedActiveMayShare, mayManageStructure: fetchedActiveMayManageStructure } =
    useDriveShareMyRights({
      path: activeFile?.apiPath ?? "",
      operations: shareOperations,
      enabled: needsActiveRightsFetch,
    });
  const activeMayShare = activeFile?.mayShare ?? fetchedActiveMayShare;
  const activeMayManageStructure =
    activeFile?.mayManageStructure ?? fetchedActiveMayManageStructure;
  const shareEnabled = Boolean(shareOperations);

  const handleShare = useCallback(
    (file: DriveFile) => {
      if (!file.apiPath) return;
      shareDialog.openShareDialog(file.apiPath, file.title);
    },
    [shareDialog],
  );

  const fileCanShare = useCallback(
    (file: DriveFile) =>
      resolveDocsHomeFileCanShare({
        shareEnabled,
        apiPath: file.apiPath,
        isActive: file.id === activeFile?.id,
        fileMayShare: file.mayShare,
        activeMayShare,
      }),
    [activeFile?.id, activeMayShare, shareEnabled],
  );

  const fileCanManageStructure = useCallback(
    (file: DriveFile) =>
      resolveDriveFileCanManageStructure(file.mayManageStructure, {
        isActive: file.id === activeFile?.id,
        activeMayManageStructure,
      }),
    [activeFile?.id, activeMayManageStructure],
  );

  const sharedBrowserProps = {
    items: files,
    selectedIds,
    starred: starred ?? {},
    labels: driveLabels,
    searchActive: false,
    inTrash: false,
    selectionMode,
    isTouch,
    showLocationColumn: true,
    isItemDragging,
    itemDragHandlers,
    folderDropZoneProps: () => ({}),
    onSelect: handleSelect,
    onOpen: openFile,
    onLongPress: enterSelectionFor,
    onStar: onStar ?? noop,
    onDownload: onDownload ?? noop,
    onRename: onRename ?? noop,
    onMove: onMove ?? noop,
    onTrash: onTrash ?? noop,
    onShare: shareEnabled ? handleShare : undefined,
    fileCanShare: shareEnabled ? fileCanShare : undefined,
    fileCanManageStructure,
    offlinePendingSyncIds,
    offlineBadgeLabels: offlineLabels,
  };

  const gridBrowserProps = { ...sharedBrowserProps, filePreviews: gridFilePreviews };

  return (
    <section className="docs-home-pane">
      <div className="docs-home-pane__header">
        <ViewHeader
          title={title ?? labels.homeTitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          searchPlaceholder={searchEnabled ? labels.homeSearchPlaceholder : undefined}
          searchValue={searchEnabled ? query : undefined}
          onSearchInput={searchEnabled ? onQueryChange : undefined}
          searchInputRef={searchInputRef}
          actions={
            <ViewModeToggle
              value={viewMode}
              onChange={onViewModeChange}
              gridLabel={driveLabels.gridView}
              listLabel={driveLabels.listView}
            />
          }
        />
      </div>

      <div className="docs-home-pane__body drive-workspace">
        {loading ? (
          <CollectionState variant="loading">{labels.homeLoading}</CollectionState>
        ) : error ? (
          <CollectionState icon={<FileText className="size-12" />}>{error}</CollectionState>
        ) : files.length === 0 ? (
          <CollectionState icon={<FileText className="size-12" />}>
            {emptyMessage ?? labels.homeEmpty}
          </CollectionState>
        ) : (
          <>
            {viewMode === "grid" ? (
              <DriveGridView {...gridBrowserProps} />
            ) : (
              <DriveListView
                {...sharedBrowserProps}
                activeId={activeId}
                showKindColumn={false}
                locationColumnLabel={labels.homeLocationColumn}
              />
            )}
            {hasMore ? (
              <div className="docs-home-pane__load-more">
                <Button
                  variant="subtle"
                  size="sm"
                  label={labels.homeLoadMore}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  onClick={onLoadMore}
                />
              </div>
            ) : null}
          </>
        )}
        {selectionBar}
      </div>

      {shareOperations ? (
        <ShareDialog
          path={shareDialog.shareDialog.path}
          title={shareDialog.shareDialog.title}
          open={shareDialog.shareDialog.open}
          onOpenChange={shareDialog.handleShareDialogOpenChange}
          shareOperations={shareOperations}
          dialogSurfaceClassName="docs-dialog-surface"
        />
      ) : null}
    </section>
  );
}
