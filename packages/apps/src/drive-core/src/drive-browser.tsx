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
import {
  DriveOfflineBadge,
  DriveOfflinePinButton,
  type DriveOfflineBadgeLabels,
} from "@/drive-core/src/drive-offline-pin-button";
import { DriveUploadStatus } from "@/drive-core/src/drive-upload-status";
import { DriveUploadRing } from "@/drive-core/src/drive-upload-ring";
import {
  DriveLocationLabel,
  DriveShareIndicators,
  DriveTileMeta,
} from "@/drive-core/src/drive-browser-indicators";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { driveFolderUiPath } from "@/drive-core/src/drive-item-path";
import {
  DRIVE_KIND_LABEL,
  DRIVE_LIST_SORT_COLUMNS,
  formatDriveModified,
  type DriveListSort,
  type DriveListSortKey,
} from "@/drive-core/src/drive-list-sort";
import { listSortAria } from "@/lib/list-sort";
import { SortableColumnHeader } from "@/ui/sortable-column-header";
import "@/ui/list-head-bar.css";
import "@/drive-core/src/drive-browser.css";
import "@/file-preview/src/file-preview.css";

function DriveFileOfflinePinCell({
  file,
  labels,
  offlineEnabled,
  isOfflineAvailable,
  isOfflinePendingSync,
  isPinning,
  canPinOffline,
  onMakeOfflineAvailable,
}: {
  file: DriveFile;
  labels: DriveUILabels;
  offlineEnabled: boolean;
  isOfflineAvailable: boolean;
  isOfflinePendingSync: boolean;
  isPinning: boolean;
  canPinOffline: boolean;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
}) {
  // An upload placeholder shows its progress in the offline control's slot.
  if (file.upload) return <DriveUploadRing file={file} />;
  if (!offlineEnabled || file.kind === "folder") return null;

  return (
    <DriveOfflinePinButton
      labels={labels}
      isAvailable={isOfflineAvailable}
      isPending={isOfflinePendingSync}
      isPinning={isPinning}
      canPin={canPinOffline}
      onPin={onMakeOfflineAvailable ? () => onMakeOfflineAvailable(file) : undefined}
    />
  );
}

/* ---------------- Grid view ---------------- */

/**
 * Multi-select intent: selection mode (long-press, right-click) or more than one
 * item (Cmd/Shift-click). A plain click selects one item and shows no bar.
 */
function multiSelectAttr(selectionMode: boolean, selectedIds: string[]) {
  return selectionMode || selectedIds.length > 1 ? "true" : "false";
}

/**
 * The one item of a list or grid that Tab reaches (roving focus): the current item,
 * else the first selected, else the first. ↑/↓ then move focus within the list.
 */
function listFocusId(
  items: DriveFile[],
  activeId: string | null | undefined,
  selectedIds: string[],
): string | undefined {
  const visible = (id: string | null | undefined): id is string =>
    !!id && items.some((file) => file.id === id);
  if (visible(activeId)) return activeId;
  return selectedIds.find(visible) ?? items[0]?.id;
}

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
  const folders = items.filter((i) => i.kind === "folder");
  const files = items.filter((i) => i.kind !== "folder");
  const focusId = listFocusId([...folders, ...files], activeId, selectedIds);

  return (
    <div
      className="drive-grid-layout"
      data-multi-select={multiSelectAttr(selectionMode, selectedIds)}
    >
      {folders.length > 0 && (
        <Section title={labels.gridSectionFolders}>
          <div className="drive-grid">
            {folders.map((f) => (
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
            ))}
          </div>
        </Section>
      )}

      {files.length > 0 && (
        <Section title={labels.gridSectionFiles}>
          <div className="drive-grid">
            {files.map((f) => (
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
            ))}
          </div>
        </Section>
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

/* ---------------- List view (OS-style table) ---------------- */

export function DriveListView({
  items,
  activeId,
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
  onStar,
  onDownload,
  onRename,
  onMove,
  onTrash,
  onShare,
  fileCanShare,
  fileCanManageStructure,
  onLongPress,
  searchActive = false,
  showLocationColumn = false,
  locationColumnLabel = "Location",
  showKindColumn = true,
  showSizeColumn = true,
  offlineAvailableIds,
  offlinePinnedIds,
  offlinePendingSyncIds,
  offlineEnabled = false,
  onMakeOfflineAvailable,
  canPinOffline = false,
  extraFileActions,
  pinLoadingId,
  offlineBadgeLabels,
  itemChrome = "manage",
  isItemDisabled,
  sort,
  onSort,
}: {
  items: DriveFile[];
  /** A picker row that cannot be chosen (a file when picking a folder): dimmed, no click. */
  isItemDisabled?: (file: DriveFile) => boolean;
  /** Column sort; omit for a list that keeps its given order (headers stay plain). */
  sort?: DriveListSort;
  onSort?: (key: DriveListSortKey) => void;
  activeId: string | null;
  selectedIds: string[];
  starred: Record<string, boolean>;
  selectionMode: boolean;
  isTouch: boolean;
  labels: DriveUILabels;
  searchActive?: boolean;
  /** Show a Location column (between Name and Last modified) for cross-drive listings. */
  showLocationColumn?: boolean;
  /** Header label for the optional Location column. */
  locationColumnLabel?: string;
  /** Show the "Kind" column. Defaults to `true`; Docs home hides it (all documents). */
  showKindColumn?: boolean;
  /** Show the "Size" column. Defaults to `true`; the folder picker hides it. */
  showSizeColumn?: boolean;
  offlineAvailableIds?: ReadonlySet<string>;
  offlinePinnedIds?: ReadonlySet<string>;
  offlinePendingSyncIds?: ReadonlySet<string>;
  offlineEnabled?: boolean;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
  canPinOffline?: boolean;
  extraFileActions?: (file: DriveFile) => ActionBarAction[];
  pinLoadingId?: string | null;
  offlineBadgeLabels?: DriveOfflineBadgeLabels;
  inTrash: boolean;
  isItemDragging: (id: string) => boolean;
  itemDragHandlers: (id: string) => ItemDragHandlers;
  folderDropZoneProps: (destinationPath: string) => FolderDropZoneProps;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (f: DriveFile) => void;
  onStar: (id: string) => void;
  onDownload: (file: DriveFile) => void;
  onRename: (file: DriveFile) => void;
  onMove: (file: DriveFile) => void;
  onTrash: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  fileCanShare?: (file: DriveFile) => boolean;
  fileCanManageStructure?: (file: DriveFile) => boolean;
  onLongPress: (id: string) => void;
  /** `picker` hides the actions column and drag/drop. */
  itemChrome?: "manage" | "picker";
}) {
  const pickerChrome = itemChrome === "picker";
  // The offline column also holds an upload's progress ring.
  const slotColumn = offlineEnabled || items.some((file) => file.upload);
  const head = (key: DriveListSortKey, label: string, align: "start" | "end" = "start") =>
    sort && onSort ? (
      <SortableColumnHeader
        label={label}
        sortKey={key}
        sort={sort}
        onSort={onSort}
        firstDirection={DRIVE_LIST_SORT_COLUMNS[key]}
        align={align}
      />
    ) : (
      label
    );
  const ariaSort = (key: DriveListSortKey) => (sort ? listSortAria(sort, key) : undefined);
  // The last column always lines up at the end (actions, else the last data column).
  const endColumn = pickerChrome
    ? showSizeColumn
      ? "size"
      : showKindColumn
        ? "kind"
        : "modified"
    : "actions";
  const endAlign = (key: "modified" | "kind") => (endColumn === key ? "end" : "start");
  const focusId = listFocusId(items, activeId, selectedIds);
  return (
    <div
      className="drive-list-view"
      data-multi-select={multiSelectAttr(selectionMode, selectedIds)}
    >
      <table
        className="drive-list-table"
        role="grid"
        aria-multiselectable={!pickerChrome || undefined}
      >
        <thead className="list-head-bar">
          <tr className="drive-list-head">
            <th className="drive-list-col-name drive-list-head__cell" aria-sort={ariaSort("name")}>
              {head("name", searchActive ? labels.searchViewTitle : labels.listColumnName)}
            </th>
            {slotColumn ? (
              <th className="drive-list-col-offline drive-list-head__cell">
                <span className="sr-only">{labels.listColumnOffline}</span>
              </th>
            ) : null}
            {showLocationColumn ? (
              <th
                className="drive-list-col-location drive-list-head__cell hidden sm:table-cell"
                aria-sort={ariaSort("location")}
              >
                {head("location", locationColumnLabel)}
              </th>
            ) : null}
            <th
              className={cn(
                "drive-list-col-modified drive-list-head__cell hidden sm:table-cell",
                endColumn === "modified" && "drive-list-head__cell--align-end",
              )}
              aria-sort={ariaSort("modified")}
            >
              {head("modified", labels.listColumnLastModified, endAlign("modified"))}
            </th>
            {showKindColumn ? (
              <th
                className={cn(
                  "drive-list-col-kind drive-list-head__cell hidden lg:table-cell",
                  endColumn === "kind" && "drive-list-head__cell--align-end",
                )}
                aria-sort={ariaSort("kind")}
              >
                {head("kind", labels.listColumnKind, endAlign("kind"))}
              </th>
            ) : null}
            {showSizeColumn ? (
              <th
                className="drive-list-col-size drive-list-head__cell drive-list-head__cell--align-end hidden sm:table-cell"
                aria-sort={ariaSort("size")}
              >
                {head("size", labels.listColumnSize, "end")}
              </th>
            ) : null}
            {pickerChrome ? null : (
              <th className="drive-list-col-actions drive-list-head__cell drive-list-head__cell--align-end">
                {labels.listColumnActions}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((f) => {
            const isFolder = f.kind === "folder";
            const folderPath = isFolder ? driveFolderUiPath(f) : "";
            const isSelected = selectedIds.includes(f.id);
            const isActive = f.id === activeId;
            const isDisabled = isItemDisabled?.(f) ?? false;
            const isOfflineAvailable = offlineAvailableIds?.has(f.id) ?? false;
            const isOfflinePendingSync = offlinePendingSyncIds?.has(f.id) ?? false;
            const isPinning = pinLoadingId === f.apiPath;
            const dropZone = isFolder
              ? folderDropZoneProps(folderPath)
              : ({} as FolderDropZoneProps);
            const dragHandlers = itemDragHandlers(f.id);
            const lp = {
              start: undefined as undefined | (() => void),
              cancel: undefined as undefined | (() => void),
            };
            let pressTimer: ReturnType<typeof setTimeout> | null = null;
            const longPressStart = () => {
              pressTimer = setTimeout(() => onLongPress(f.id), 450);
            };
            const longPressCancel = () => {
              if (pressTimer) clearTimeout(pressTimer);
              pressTimer = null;
            };
            lp.start = longPressStart;
            lp.cancel = longPressCancel;

            return (
              <tr
                key={f.id}
                data-list-item-id={f.id}
                data-list-item-focus=""
                tabIndex={f.id === focusId ? 0 : -1}
                aria-selected={isSelected}
                data-selection-mode={selectionMode ? "true" : "false"}
                aria-disabled={isDisabled || undefined}
                onClick={isDisabled ? undefined : (e) => onSelect(f.id, e)}
                onDoubleClick={selectionMode ? undefined : () => onOpen(f)}
                onTouchStart={pickerChrome ? undefined : lp.start}
                onTouchEnd={pickerChrome ? undefined : lp.cancel}
                onTouchMove={pickerChrome ? undefined : lp.cancel}
                onContextMenu={
                  pickerChrome
                    ? undefined
                    : (e) => {
                        if (!isTouch) {
                          e.preventDefault();
                          onLongPress(f.id);
                        }
                      }
                }
                draggable={!pickerChrome && !isTouch}
                onDragStart={pickerChrome ? undefined : dragHandlers.onDragStart}
                onDragEnd={pickerChrome ? undefined : dragHandlers.onDragEnd}
                className={cn(
                  "drive-list-row group cursor-default transition-colors",
                  isItemDragging(f.id) && "drive-list-row--dragging",
                  isFolder && dropZone.isDropTarget && "drive-list-row--drop-target",
                  isSelected && "drive-list-row--selected",
                  isActive && !isSelected && "drive-list-row--active",
                  isDisabled && "drive-list-row--disabled",
                )}
              >
                <td
                  className="drive-list-col-name py-2 min-w-0"
                  {...(isFolder && !pickerChrome ? dropZone : {})}
                >
                  <div className="drive-list-row__name flex items-center gap-2.5 min-w-0">
                    <DriveFileAvatar file={f} size="sm" />
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate font-medium">{f.title}</span>
                      <DriveShareIndicators file={f} labels={labels} />
                      <DriveUploadStatus file={f} />
                      {starred[f.id] ? (
                        <Star
                          className="size-3 shrink-0 drive-list-folder-icon"
                          fill="currentColor"
                        />
                      ) : null}
                      {!offlineEnabled ? (
                        <DriveOfflineBadge
                          pinned={offlinePinnedIds?.has(f.id) ?? false}
                          pending={isOfflinePendingSync}
                          labels={offlineBadgeLabels}
                        />
                      ) : null}
                    </div>
                  </div>
                </td>
                {slotColumn ? (
                  <td
                    className="drive-list-col-offline py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DriveFileOfflinePinCell
                      file={f}
                      labels={labels}
                      offlineEnabled={offlineEnabled}
                      isOfflineAvailable={isOfflineAvailable}
                      isOfflinePendingSync={isOfflinePendingSync}
                      isPinning={isPinning}
                      canPinOffline={canPinOffline}
                      onMakeOfflineAvailable={onMakeOfflineAvailable}
                    />
                  </td>
                ) : null}
                {showLocationColumn ? (
                  <td className="drive-list-col-location py-2 hidden sm:table-cell drive-list-muted min-w-0">
                    <DriveLocationLabel file={f} />
                  </td>
                ) : null}
                <td
                  className={cn(
                    "drive-list-col-modified py-2 hidden sm:table-cell tabular-nums drive-list-muted whitespace-nowrap",
                    endColumn === "modified" && "text-right",
                  )}
                >
                  {formatDriveModified(f)}
                </td>
                {showKindColumn ? (
                  <td
                    className={cn(
                      "drive-list-col-kind py-2 hidden lg:table-cell drive-list-muted",
                      endColumn === "kind" && "text-right",
                    )}
                  >
                    {DRIVE_KIND_LABEL[f.kind]}
                  </td>
                ) : null}
                {showSizeColumn ? (
                  <td className="drive-list-col-size py-2 text-right tabular-nums drive-list-muted hidden sm:table-cell">
                    {f.size}
                  </td>
                ) : null}
                {pickerChrome ? null : (
                  <td
                    className="drive-list-col-actions py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex justify-end">
                      <DriveFileItemActions
                        labels={labels}
                        file={f}
                        isStarred={!!starred[f.id]}
                        inTrash={inTrash}
                        canOpen={!selectionMode}
                        onOpen={() => onOpen(f)}
                        onDownload={onDownload}
                        onStar={() => onStar(f.id)}
                        onRename={() => onRename(f)}
                        onMove={() => onMove(f)}
                        onDelete={() => onTrash(f)}
                        canShare={fileCanShare?.(f)}
                        canManageStructure={fileCanManageStructure?.(f)}
                        onShare={onShare ? () => onShare(f) : undefined}
                        extraActions={extraFileActions?.(f)}
                        disabled={isPinning}
                      />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
