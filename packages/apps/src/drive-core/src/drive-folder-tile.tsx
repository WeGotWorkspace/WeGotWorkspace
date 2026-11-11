import { Star } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { DriveShareIndicators, DriveTileMeta } from "@/drive-core/src/drive-browser-indicators";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
import { DriveFileItemActions } from "@/drive-core/src/drive-file-actions";
import {
  type FolderDropZoneProps,
  type ItemDragHandlers,
} from "@/drive-core/src/drive-browser-item-parts";
import { useLongPress } from "@/drive-core/src/use-drive-long-press";
import { DriveUploadStatus } from "@/drive-core/src/drive-upload-status";
import { cn } from "@/lib/utils";

/**
 * A folder in the grid. A folder still being uploaded (#1620) shows its
 * progress under the name and the upload's own actions in its menu.
 */
export function DriveFolderTile({
  file,
  isSelected,
  isFocusTarget = false,
  selectionMode,
  isStarred,
  isDragging,
  isTouch,
  folderDropZone,
  itemDragHandlers,
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
  extraActions,
  itemChrome = "manage",
}: {
  file: DriveFile;
  isSelected: boolean;
  /** The tile Tab reaches (roving focus). */
  isFocusTarget?: boolean;
  selectionMode: boolean;
  isStarred: boolean;
  isDragging: boolean;
  isTouch: boolean;
  folderDropZone: FolderDropZoneProps;
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
  extraActions?: ActionBarAction[];
  itemChrome?: "manage" | "picker";
}) {
  const lp = useLongPress(onLongPress);
  const pickerChrome = itemChrome === "picker";
  // Tile root is non-interactive so the actions menu is not nested inside a
  // button (axe nested-interactive); the overlay button is the click target.
  return (
    <div
      data-list-item-id={file.id}
      onContextMenu={
        pickerChrome
          ? undefined
          : (e) => {
              if (!isTouch) {
                e.preventDefault();
                onLongPress();
              }
            }
      }
      draggable={!pickerChrome && !isTouch}
      onDragStart={pickerChrome ? undefined : itemDragHandlers.onDragStart}
      onDragEnd={pickerChrome ? undefined : itemDragHandlers.onDragEnd}
      {...(pickerChrome ? {} : folderDropZone)}
      className={cn(
        "group drive-folder-tile",
        selectionMode && "drive-folder-tile--selection-mode",
        isDragging && "drive-folder-tile--dragging",
        folderDropZone.isDropTarget && "drive-folder-tile--drop-target",
        isSelected && "drive-folder-tile--selected",
        !isSelected && !folderDropZone.isDropTarget && "drive-folder-tile--idle",
      )}
    >
      <button
        type="button"
        aria-label={file.title}
        className="drive-tile__hit"
        tabIndex={isFocusTarget ? 0 : -1}
        data-list-item-focus=""
        onClick={(e) => {
          if (lp.fired.current) return;
          onSelect(e);
        }}
        onDoubleClick={selectionMode ? undefined : onOpen}
        onTouchStart={pickerChrome ? undefined : lp.start}
        onTouchEnd={pickerChrome ? undefined : lp.cancel}
        onTouchMove={pickerChrome ? undefined : lp.cancel}
      />
      <DriveFileAvatar file={file} />
      <span className="drive-folder-tile__text">
        <span className="drive-folder-tile__title-row">
          <span className="drive-folder-tile__title">{file.title}</span>
          {isStarred ? <Star className="drive-folder-tile__star" fill="currentColor" /> : null}
          <DriveShareIndicators file={file} labels={labels} />
        </span>
        <DriveUploadStatus file={file} />
        <DriveTileMeta file={file} />
      </span>
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
        />
      )}
    </div>
  );
}
