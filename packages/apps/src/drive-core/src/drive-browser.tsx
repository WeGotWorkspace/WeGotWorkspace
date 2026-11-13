import { useCallback, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { DriveFile } from "@/lib/files/drive-models";
import { cn } from "@/lib/utils";
import {
  type FolderDropZoneProps,
  type ItemDragHandlers,
} from "@/drive-core/src/drive-browser-item-parts";
import { DriveFileItemActions } from "@/drive-core/src/drive-file-actions";
import { DriveFolderTile } from "@/drive-core/src/drive-folder-tile";
import { useDriveTileTarget } from "@/drive-core/src/use-drive-tile-target";

import { DriveUploadStatus } from "@/drive-core/src/drive-upload-status";
import { DriveShareIndicators, DriveTileMeta } from "@/drive-core/src/drive-browser-indicators";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { driveFolderUiPath } from "@/drive-core/src/drive-item-path";

import { useWorkspaceListRows } from "@/workspace-list/src/use-workspace-list-rows";
import {
  DRIVE_GRID_WINDOW_AFTER_TILES,
  driveGridRowEstimate,
  driveGridRowKey,
  driveGridRowKeyByFileId,
  driveGridRows,
  isDriveGridHeader,
  type DriveGridRowItem,
  type DriveGridSection,
} from "@/drive-core/src/drive-grid-rows";
import { useDriveGridColumns } from "@/drive-core/src/use-drive-grid-columns";
import "@/ui/list-head-bar.css";
import "@/drive-core/src/drive-browser.css";
import "@/file-preview/src/file-preview.css";
import { DriveFileOfflinePinCell } from "@/drive-core/src/drive-offline-pin-cell";
import { listFocusId, multiSelectAttr } from "@/drive-core/src/drive-browser-focus";

/* ---------------- Grid view ---------------- */

export function DriveGridView({
  items,
  activeId,
  filePreviews,
  selectedIds,
  starred,
  labels,
  inTrash,
  selectionMode,
  isTouch,
  isItemDragging,
  itemDragHandlers,
  folderDropZoneProps,
  onSelect,
  onOpen,
  onLongPress,
  onStar,
  onDownload,
  onRename,
  onMove,
  onTrash,
  onShare,
  fileCanShare,
  fileCanManageStructure,
  offlineAvailableIds,
  offlinePendingSyncIds,
  offlineEnabled = false,
  onMakeOfflineAvailable,
  canPinOffline = false,
  extraFileActions,
  pinLoadingId,
  itemChrome = "manage",
}: {
  items: DriveFile[];
  /** The current item (keyboard focus lands here). */
  activeId?: string | null;
  filePreviews: Record<string, FilePreviewPayload>;
  selectedIds: string[];
  starred: Record<string, boolean>;
  labels: DriveUILabels;
  searchActive?: boolean;
  /** Shared with the list view; tiles leave the drive out (no room). */
  showLocationColumn?: boolean;
  offlineAvailableIds?: ReadonlySet<string>;
  offlinePendingSyncIds?: ReadonlySet<string>;
  /** When true, show cloud/download affordances for files without a local copy. */
  offlineEnabled?: boolean;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
  /** When false (offline), cloud icon is decorative only. */
  canPinOffline?: boolean;
  extraFileActions?: (file: DriveFile) => ActionBarAction[];
  pinLoadingId?: string | null;
  inTrash: boolean;
  selectionMode: boolean;
  isTouch: boolean;
  isItemDragging: (id: string) => boolean;
  itemDragHandlers: (id: string) => ItemDragHandlers;
  folderDropZoneProps: (destinationPath: string) => FolderDropZoneProps;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (f: DriveFile) => void;
  onLongPress: (id: string) => void;
  onStar: (id: string) => void;
  onDownload: (file: DriveFile) => void;
  onRename: (file: DriveFile) => void;
  onMove: (file: DriveFile) => void;
  onTrash: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  fileCanShare?: (file: DriveFile) => boolean;
  /** When set, omit rename / move / delete without full access. */
  fileCanManageStructure?: (file: DriveFile) => boolean;
  /**
   * `picker` hides overflow (star/rename/move/trash/share) and drag/drop.
   * Used by Drive folder-picker file-select mode.
   */
  itemChrome?: "manage" | "picker";
}) {
  const { folders, files } = useMemo(
    () => ({
      folders: items.filter((i) => i.kind === "folder"),
      files: items.filter((i) => i.kind !== "folder"),
    }),
    [items],
  );
  const focusId = listFocusId([...folders, ...files], activeId, selectedIds);

  const renderFolderTile = (f: DriveFile) => (
    <DriveFolderTile
      key={f.id}
      file={f}
      isSelected={selectedIds.includes(f.id)}
      isFocusTarget={f.id === focusId}
      selectionMode={selectionMode}
      isStarred={!!starred[f.id]}
      isDragging={isItemDragging(f.id)}
      isTouch={isTouch}
      folderDropZone={folderDropZoneProps(driveFolderUiPath(f))}
      itemDragHandlers={itemDragHandlers(f.id)}
      onSelect={(e) => onSelect(f.id, e)}
      onOpen={() => onOpen(f)}
      onLongPress={() => onLongPress(f.id)}
      labels={labels}
      inTrash={inTrash}
      onStar={() => onStar(f.id)}
      onDownload={onDownload}
      onRename={() => onRename(f)}
      onMove={() => onMove(f)}
      onTrash={() => onTrash(f)}
      canShare={fileCanShare?.(f)}
      canManageStructure={fileCanManageStructure?.(f)}
      onShare={onShare ? () => onShare(f) : undefined}
      extraActions={extraFileActions?.(f)}
      itemChrome={itemChrome}
    />
  );
  const renderFileTile = (f: DriveFile) => (
    <FileTile
      key={f.id}
      file={f}
      preview={filePreviews[f.id]}
      isSelected={selectedIds.includes(f.id)}
      isFocusTarget={f.id === focusId}
      selectionMode={selectionMode}
      isStarred={!!starred[f.id]}
      isDragging={isItemDragging(f.id)}
      isTouch={isTouch}
      isOfflineAvailable={offlineAvailableIds?.has(f.id) ?? false}
      isOfflinePendingSync={offlinePendingSyncIds?.has(f.id) ?? false}
      offlineEnabled={offlineEnabled}
      canPinOffline={canPinOffline}
      onMakeOfflineAvailable={onMakeOfflineAvailable}
      extraActions={extraFileActions?.(f)}
      actionsDisabled={pinLoadingId === f.apiPath}
      itemDragHandlers={itemDragHandlers(f.id)}
      onSelect={(e) => onSelect(f.id, e)}
      onOpen={() => onOpen(f)}
      onLongPress={() => onLongPress(f.id)}
      labels={labels}
      inTrash={inTrash}
      onStar={() => onStar(f.id)}
      onDownload={onDownload}
      onRename={() => onRename(f)}
      onMove={() => onMove(f)}
      onTrash={() => onTrash(f)}
      canShare={fileCanShare?.(f)}
      canManageStructure={fileCanManageStructure?.(f)}
      onShare={onShare ? () => onShare(f) : undefined}
      itemChrome={itemChrome}
    />
  );

  // Above 80 tiles the grid becomes rows of tiles, and only the rows near the
  // viewport mount (#1641 step d). Smaller grids stay one grid per section.
  const windowed = items.length > DRIVE_GRID_WINDOW_AFTER_TILES;
  const [layout, setLayout] = useState<HTMLElement | null>(null);
  const columns = useDriveGridColumns(layout, windowed);
  const gridRows = useMemo(
    () => (windowed ? driveGridRows(folders, files, columns) : []),
    [columns, files, folders, windowed],
  );
  const rowKeyByFileId = useMemo(() => driveGridRowKeyByFileId(gridRows), [gridRows]);
  const keyOfItemId = useCallback((id: string) => rowKeyByFileId.get(id), [rowKeyByFileId]);
  const focusRowKey = focusId ? rowKeyByFileId.get(focusId) : undefined;
  const pinnedKeys = useMemo(() => (focusRowKey ? [focusRowKey] : undefined), [focusRowKey]);
  const sectionTitle = (section: DriveGridSection) =>
    section === "folders" ? labels.gridSectionFolders : labels.gridSectionFiles;
  const { attachList, rows, dataAttributes } = useWorkspaceListRows({
    items: gridRows,
    getKey: driveGridRowKey,
    renderItem: (row: DriveGridRowItem) =>
      row.kind === "header" ? (
        <h3 className="list-head-bar drive-browser-section-title">{sectionTitle(row.section)}</h3>
      ) : (
        <div className={cn("drive-grid", !row.last && "drive-grid--row-gap")}>
          {row.files.map(row.section === "folders" ? renderFolderTile : renderFileTile)}
        </div>
      ),
    estimateSize: driveGridRowEstimate,
    isHeader: isDriveGridHeader,
    renderSection: (header, content) => (
      <section
        aria-label={sectionTitle(header.section)}
        className={cn(header.kind === "header" && header.after && "drive-grid-section--after")}
      >
        {content}
      </section>
    ),
    activeId: (activeId && rowKeyByFileId.get(activeId)) || "",
    pinnedKeys,
    keyOfItemId,
    windowAfter: 0,
    animateReorder: false,
  });
  const attachLayout = useCallback(
    (node: HTMLElement | null) => {
      attachList(node);
      setLayout(node);
    },
    [attachList],
  );

  return (
    <div
      ref={attachLayout}
      className={cn("drive-grid-layout", windowed && "drive-grid-layout--windowed")}
      data-multi-select={multiSelectAttr(selectionMode, selectedIds)}
      {...(windowed ? dataAttributes : {})}
    >
      {windowed ? (
        rows
      ) : (
        <>
          {folders.length > 0 && (
            <Section title={labels.gridSectionFolders}>
              <div className="drive-grid">{folders.map(renderFolderTile)}</div>
            </Section>
          )}

          {files.length > 0 && (
            <Section title={labels.gridSectionFiles}>
              <div className="drive-grid">{files.map(renderFileTile)}</div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** A grid section: its heading is the list head bar, sticky while the section scrolls. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="list-head-bar drive-browser-section-title">{title}</h3>
      {children}
    </section>
  );
}

function FileTile({
  file,
  preview,
  isSelected,
  isFocusTarget = false,
  selectionMode,
  isStarred,
  isDragging,
  isTouch,
  isOfflineAvailable = false,
  isOfflinePendingSync = false,
  offlineEnabled = false,
  canPinOffline = false,
  onMakeOfflineAvailable,
  extraActions,
  actionsDisabled = false,
  onSelect,
  onOpen,
  onLongPress,
  labels,
  inTrash,
  onStar,
  onDownload,
  onRename,
  onMove,
  onTrash,
  canShare,
  canManageStructure,
  onShare,
  itemDragHandlers,
  itemChrome = "manage",
}: {
  file: DriveFile;
  preview?: FilePreviewPayload;
  isSelected: boolean;
  /** The tile Tab reaches (roving focus). */
  isFocusTarget?: boolean;
  selectionMode: boolean;
  isStarred: boolean;
  isDragging: boolean;
  isTouch: boolean;
  isOfflineAvailable?: boolean;
  isOfflinePendingSync?: boolean;
  offlineEnabled?: boolean;
  canPinOffline?: boolean;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
  extraActions?: ActionBarAction[];
  actionsDisabled?: boolean;
  itemDragHandlers: ItemDragHandlers;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onLongPress: () => void;
  labels: DriveUILabels;
  inTrash: boolean;
  onStar: () => void;
  onDownload: (file: DriveFile) => void;
  onRename: () => void;
  onMove: () => void;
  onTrash: () => void;
  canShare?: boolean;
  canManageStructure?: boolean;
  onShare?: () => void;
  itemChrome?: "manage" | "picker";
}) {
  const pickerChrome = itemChrome === "picker";
  const { rootProps, hit } = useDriveTileTarget({
    file,
    pickerChrome,
    isTouch,
    isFocusTarget,
    selectionMode,
    itemDragHandlers,
    onSelect,
    onOpen,
    onLongPress,
  });
  return (
    <div
      data-drive-file-id={file.id}
      {...rootProps}
      className={cn(
        "group drive-file-tile",
        selectionMode && "drive-file-tile--selection-mode",
        isDragging && "drive-file-tile--dragging",
        isSelected && "drive-file-tile--selected",
      )}
    >
      {hit}
      <span className="drive-file-tile__avatar">
        <DriveFileAvatar file={file} preview={preview} />
      </span>
      <div className="drive-file-tile__footer">
        <div className="drive-file-tile__text min-w-0 flex-1">
          <div className="drive-file-tile__title-row">
            <span className="drive-file-tile__title">{file.title}</span>
            {isStarred ? (
              <Star className="drive-file-tile__star-badge" fill="currentColor" aria-hidden />
            ) : null}
            <DriveShareIndicators file={file} labels={labels} />
          </div>
          <DriveUploadStatus file={file} />
          <DriveTileMeta file={file} />
        </div>
        <div className="drive-file-tile__actions flex shrink-0 items-center">
          <DriveFileOfflinePinCell
            file={file}
            labels={labels}
            offlineEnabled={offlineEnabled}
            isOfflineAvailable={isOfflineAvailable}
            isOfflinePendingSync={isOfflinePendingSync}
            isPinning={actionsDisabled}
            canPinOffline={canPinOffline}
            onMakeOfflineAvailable={onMakeOfflineAvailable}
          />
          {pickerChrome ? null : (
            <DriveFileItemActions
              labels={labels}
              file={file}
              isStarred={isStarred}
              inTrash={inTrash}
              canOpen={!selectionMode}
              onOpen={onOpen}
              onDownload={onDownload}
              onStar={onStar}
              onRename={onRename}
              onMove={onMove}
              onDelete={onTrash}
              canShare={canShare}
              canManageStructure={canManageStructure}
              onShare={onShare}
              extraActions={extraActions}
              disabled={actionsDisabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
