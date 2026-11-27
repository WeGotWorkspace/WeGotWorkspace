import { useMemo, useRef } from "react";
import { Cloud, CloudAlert, CloudOff, Download, FolderX } from "lucide-react";
import { Button } from "@/button/src/button";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { CollectionState } from "@/collection-state/src/collection-state";
import { FileDropOverlay } from "@/file-drop-overlay/src/file-drop-overlay";
import { DriveGridView } from "@/drive-core/src/drive-browser";
import { DriveListView } from "@/drive-core/src/drive-list-view";
import type { DriveFile } from "@/lib/files/drive-models";
import { startDriveItemDownload } from "@/drive-core/src/drive-item-download";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import { resolveGridFilePreview } from "@/lib/file-preview/file-preview-utils";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { useDriveController } from "@/drive-core/src/use-drive-controller";
import { isTopLevelDriveApiPath } from "@/lib/files/drive-path-utils";
import { useProjectFolders } from "@/drive-core/src/drive-project-folder";
import { resolveDriveFileCanManageStructure } from "@/drive-core/src/drive-file-structure-rights";
import { useDriveTilesInView } from "@/drive-core/src/use-drive-tiles-in-view";
import { DriveUploadsPane } from "@/drive-core/src/drive-uploads-pane";
import { DriveUploadNotices } from "@/drive-core/src/drive-upload-notices";
import { useDriveUploadQueueContext } from "@/drive-core/src/drive-upload-queue";

type DriveController = ReturnType<typeof useDriveController>;

const NO_PLACEHOLDER_DRAG = {
  onDragStart: (event: React.DragEvent) => event.preventDefault(),
  onDragEnd: () => {},
};

export type DriveMainPaneProps = {
  controller: DriveController;
  operations?: DriveAPIOperations;
  openFile?: (file: DriveFile) => void;
  offlineEnabled?: boolean;
  offlineAvailableIds?: ReadonlySet<string>;
  offlinePendingSyncIds?: ReadonlySet<string>;
  offlineFailedIds?: ReadonlySet<string>;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
  pinLoadingId?: string | null;
  extraFileActions?: (file: DriveFile) => ActionBarAction[];
  shareEnabled?: boolean;
  onOpenShare?: (apiPath: string, title: string) => void;
  activeMayShare?: boolean;
  activeMayManageStructure?: boolean;
};

/** Drive folder listing only — file detail docks from DriveWorkspace (layout panel / drawer). */
export function DriveMainPane({
  controller,
  operations,
  openFile: openFileOverride,
  offlineEnabled = false,
  offlineAvailableIds,
  offlinePendingSyncIds,
  offlineFailedIds,
  onMakeOfflineAvailable,
  pinLoadingId,
  extraFileActions,
  shareEnabled = false,
  onOpenShare,
  activeMayShare,
  activeMayManageStructure,
}: DriveMainPaneProps) {
  const {
    labels,
    view,
    dropUploadActive,
    setDropUploadActive,
    handleUploadDrop,
    uploadEnabled,
    structureEnabled,
    selectView,
    visibleItems,
    listSort,
    toggleListSort,
    viewMode,
    filePreviews,
    richPreviews,
    setTilesInView,
    selectedIds,
    starred,
    selectionMode,
    isTouch,
    handleSelect,
    openFile,
    enterSelectionFor,
    toggleStar,
    requestDeleteItem,
    requestRenameItem,
    requestMoveItem,
    isItemDragging,
    itemDragHandlers,
    folderDropZoneProps,
    activeId,
    inTrashView,
    active,
    selectionBar,
    searchQuery,
    viewState,
    retryFolder,
  } = controller;

  // The view's own state shows only while there are no rows: a first sync with
  // rows lists them, and a known-empty folder shows the empty state. While
  // searching, `viewState` is the search's state.
  const paneState = view.type !== "uploads" && visibleItems.length === 0 ? viewState : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Grid previews load only for tiles on (or near) screen.
  useDriveTilesInView(scrollRef, setTilesInView, viewMode === "grid");

  const { show, showError } = useAppToast();
  const { online } = useConnectivity();
  const uploadQueue = useDriveUploadQueueContext();
  const dismissUploadNotices = operations?.dismissUploadNotices;

  const handleDownload = (file: DriveFile) => {
    // Still uploading: this device's copy, without waiting for the server.
    if (file.upload && operations?.downloadQueuedUpload) {
      void operations
        .downloadQueuedUpload(file.upload.id)
        .then((saved) => {
          if (saved) show("Download started", { icon: <Download className="size-4" /> });
          else showError(`"${file.title}" just finished uploading. Download it again.`);
        })
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    startDriveItemDownload(operations, file, showError, () =>
      show("Download started", { icon: <Download className="size-4" /> }),
    );
  };

  const searchActive = Boolean(searchQuery.trim());

  // Upload placeholders are not on the server yet: no selection, batch actions, or drag.
  const placeholderIds = useMemo(
    () => new Set(visibleItems.filter((file) => file.upload).map((file) => file.id)),
    [visibleItems],
  );
  const selectUnlessPlaceholder = (id: string, event: React.MouseEvent) => {
    if (!placeholderIds.has(id)) handleSelect(id, event);
  };
  const longPressUnlessPlaceholder = (id: string) => {
    if (!placeholderIds.has(id)) enterSelectionFor(id);
  };
  const dragUnlessPlaceholder = (id: string) =>
    placeholderIds.has(id) ? NO_PLACEHOLDER_DRAG : itemDragHandlers(id);

  const handleShare = (file: DriveFile) => {
    if (!file.apiPath || !onOpenShare) return;
    onOpenShare(file.apiPath, file.title);
  };

  const projectFolders = useProjectFolders();

  const fileCanShare = (file: DriveFile) => {
    if (!shareEnabled || inTrashView || !file.apiPath?.trim()) return false;
    if (isTopLevelDriveApiPath(file.apiPath)) return false;
    const resolvedMayShare = file.id === active?.id ? activeMayShare : file.mayShare;
    return resolvedMayShare === true;
  };

  // The server refuses to rename, move or delete a Project's folder: no actions for it.
  const fileCanManageStructure = (file: DriveFile) =>
    structureEnabled &&
    !projectFolders.isProjectFolder(file) &&
    resolveDriveFileCanManageStructure(file.mayManageStructure, {
      isActive: file.id === active?.id,
      activeMayManageStructure,
    });

  const sharedBrowserProps = {
    items: visibleItems,
    sort: listSort,
    onSort: toggleListSort,
    selectedIds,
    starred,
    labels,
    searchActive,
    inTrash: inTrashView,
    selectionMode,
    isTouch,
    showLocationColumn: true,
    locationColumnLabel: labels.listColumnLocation,
    isItemDragging,
    itemDragHandlers: dragUnlessPlaceholder,
    folderDropZoneProps,
    onSelect: selectUnlessPlaceholder,
    onOpen: openFileOverride ?? openFile,
    onLongPress: longPressUnlessPlaceholder,
    onStar: toggleStar,
    onDownload: handleDownload,
    onRename: requestRenameItem,
    onMove: requestMoveItem,
    onTrash: requestDeleteItem,
    onShare: shareEnabled ? handleShare : undefined,
    fileCanShare: shareEnabled ? fileCanShare : undefined,
    fileCanManageStructure,
    offlineEnabled,
    offlineAvailableIds,
    offlinePendingSyncIds,
    offlineFailedIds,
    onMakeOfflineAvailable,
    canPinOffline: online,
    pinLoadingId,
    extraFileActions,
    offlineBadgeLabels: {
      offlineAvailable: labels.offlineAvailable,
      offlinePendingSync: labels.offlinePendingSync,
    },
  };

  const gridFilePreviews = useMemo(() => {
    const merged: Record<string, FilePreviewPayload> = {};
    for (const file of visibleItems) {
      const resolved = resolveGridFilePreview(filePreviews, richPreviews, file.id);
      if (resolved) merged[file.id] = resolved;
    }
    return merged;
  }, [filePreviews, richPreviews, visibleItems]);

  const gridBrowserProps = { ...sharedBrowserProps, filePreviews: gridFilePreviews };

  const dropTargetLabel =
    view.type === "folder"
      ? view.path.split("/").pop() || labels.sidebarMyDrive
      : labels.sidebarMyDrive;

  return (
    <section
      className="drive-main-pane"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!uploadEnabled) {
          // Swallow the drop so the browser does not navigate away to the file.
          event.dataTransfer.dropEffect = "none";
          return;
        }
        setDropUploadActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropUploadActive(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!uploadEnabled) return;
        setDropUploadActive(false);
        handleUploadDrop(event.dataTransfer);
      }}
    >
      {dropUploadActive ? (
        <FileDropOverlay>
          {labels.dropUploadHint} {dropTargetLabel}
        </FileDropOverlay>
      ) : null}

      <div className="drive-main-pane__body">
        <div ref={scrollRef} className="drive-main-pane__scroll collection-state-host">
          {paneState === "pending" ? null : paneState === "first-sync" ? (
            <CollectionState variant="loading">{labels.allFilesLoading}</CollectionState>
          ) : paneState === "not-available" || paneState === "not-synced" ? (
            <CollectionState icon={<CloudOff className="size-12" />}>
              <p role="status">{labels.notAvailableOffline}</p>
              {paneState === "not-available" ? (
                <p className="drive-main-pane__hint">{labels.notAvailableOfflineHint}</p>
              ) : null}
            </CollectionState>
          ) : paneState === "missing" ? (
            <CollectionState icon={<FolderX className="size-12" />}>
              <p role="status">{labels.folderMissing}</p>
              <p className="drive-main-pane__hint">{labels.folderMissingHint}</p>
            </CollectionState>
          ) : paneState === "error" ? (
            <CollectionState icon={<CloudAlert className="size-12" />}>
              <p role="alert">{labels.folderListingFailed}</p>
              <Button
                className="drive-main-pane__retry"
                variant="secondary"
                size="sm"
                onClick={retryFolder}
              >
                {labels.folderListingRetry}
              </Button>
            </CollectionState>
          ) : view.type === "uploads" ? (
            <DriveUploadsPane
              files={visibleItems}
              searchActive={searchActive}
              onOpenFolder={(path) => selectView({ type: "folder", path })}
            />
          ) : visibleItems.length === 0 ? (
            <CollectionState icon={<Cloud className="size-12" />}>
              {view.type === "all" ? labels.allFilesEmpty : labels.emptyFolder}
            </CollectionState>
          ) : viewMode === "grid" ? (
            <DriveGridView {...gridBrowserProps} activeId={activeId} />
          ) : (
            <DriveListView {...sharedBrowserProps} activeId={activeId} />
          )}
        </div>
      </div>

      {uploadQueue && dismissUploadNotices ? (
        <DriveUploadNotices
          batches={uploadQueue.snapshot.batches}
          onDismiss={(batchId) => void dismissUploadNotices(batchId).catch(showError)}
        />
      ) : null}

      {selectionBar}
    </section>
  );
}
