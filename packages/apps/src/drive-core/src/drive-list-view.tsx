import { useMemo } from "react";
import { Star } from "lucide-react";
import type { DriveFile } from "@/lib/files/drive-models";
import { cn } from "@/lib/utils";
import {
  type FolderDropZoneProps,
  type ItemDragHandlers,
} from "@/drive-core/src/drive-browser-item-parts";
import { DriveFileItemActions } from "@/drive-core/src/drive-file-actions";
import {
  DriveOfflineBadge,
  type DriveOfflineBadgeLabels,
} from "@/drive-core/src/drive-offline-pin-button";
import { DriveUploadStatus } from "@/drive-core/src/drive-upload-status";
import {
  DriveLocationLabel,
  DriveShareIndicators,
} from "@/drive-core/src/drive-browser-indicators";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
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
import { useWorkspaceListRows } from "@/workspace-list/src/use-workspace-list-rows";
import { DriveListSpacer } from "@/drive-core/src/drive-list-spacer";
import { driveFileKey, driveListRowEstimate } from "@/drive-core/src/drive-list-rows";

import "@/ui/list-head-bar.css";
import "@/drive-core/src/drive-browser.css";
import "@/file-preview/src/file-preview.css";
import { DriveFileOfflinePinCell } from "@/drive-core/src/drive-offline-pin-cell";
import { listFocusId, multiSelectAttr } from "@/drive-core/src/drive-browser-focus";

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
  const renderRow = (f: DriveFile) => {
    const isFolder = f.kind === "folder";
    const folderPath = isFolder ? driveFolderUiPath(f) : "";
    const isSelected = selectedIds.includes(f.id);
    const isActive = f.id === activeId;
    const isDisabled = isItemDisabled?.(f) ?? false;
    const isOfflineAvailable = offlineAvailableIds?.has(f.id) ?? false;
    const isOfflinePendingSync = offlinePendingSyncIds?.has(f.id) ?? false;
    const isPinning = pinLoadingId === f.apiPath;
    const dropZone = isFolder ? folderDropZoneProps(folderPath) : ({} as FolderDropZoneProps);
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
                <Star className="size-3 shrink-0 drive-list-folder-icon" fill="currentColor" />
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
          <td className="drive-list-col-offline py-2" onClick={(event) => event.stopPropagation()}>
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
          <td className="drive-list-col-actions py-2" onClick={(event) => event.stopPropagation()}>
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
  };
  // Name and Last modified, then the optional columns.
  const columnCount =
    2 +
    Number(slotColumn) +
    Number(showLocationColumn) +
    Number(showKindColumn) +
    Number(showSizeColumn) +
    Number(!pickerChrome);
  const pinnedKeys = useMemo(() => (focusId ? [focusId] : undefined), [focusId]);
  const { attachList, rows, dataAttributes } = useWorkspaceListRows({
    items,
    getKey: driveFileKey,
    renderItem: renderRow,
    estimateSize: driveListRowEstimate,
    activeId: activeId ?? "",
    pinnedKeys,
    renderSpacer: (size, key) => <DriveListSpacer key={key} size={size} columns={columnCount} />,
    animateReorder: false,
  });
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
        <tbody ref={attachList} {...dataAttributes}>
          {rows}
        </tbody>
      </table>
    </div>
  );
}
