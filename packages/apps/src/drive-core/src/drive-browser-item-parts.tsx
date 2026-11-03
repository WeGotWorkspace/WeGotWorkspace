import { Check } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import { DriveFileItemActionsMenu } from "@/drive-core/src/drive-file-actions";
import { driveUploadPlaceholderMenu } from "@/drive-core/src/drive-upload-placeholder-menu";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { cn } from "@/lib/utils";

// Pieces shared by the grid tiles and the list rows of `drive-browser.tsx`.

export function DriveSelectionCheckbox({
  isSelected,
  className,
}: {
  isSelected: boolean;
  selectionMode?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("drive-selection-checkbox-wrap", className)}>
      <span
        className={cn(
          "drive-selection-checkbox",
          isSelected && "drive-selection-checkbox--selected",
        )}
      >
        {isSelected ? (
          <Check className="drive-selection-checkbox__icon" strokeWidth={2.75} />
        ) : null}
      </span>
    </span>
  );
}

export type FolderDropZoneProps = Pick<
  MenuItemProps,
  "isDropTarget" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
>;

export type ItemDragHandlers = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

export function DriveFileItemActions({
  labels,
  file,
  isStarred,
  inTrash,
  canOpen = true,
  onOpen,
  onDownload,
  onStar,
  onRename,
  onMove,
  onDelete,
  canShare,
  canManageStructure,
  onShare,
  extraActions,
  disabled = false,
}: {
  labels: DriveUILabels;
  file: DriveFile;
  isStarred: boolean;
  inTrash: boolean;
  /** When false, hide Open (matches double-click disabled in selection mode). */
  canOpen?: boolean;
  onOpen?: () => void;
  onDownload: (file: DriveFile) => void;
  onStar: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onDelete: () => void;
  canShare?: boolean;
  canManageStructure?: boolean;
  onShare?: () => void;
  extraActions?: ActionBarAction[];
  disabled?: boolean;
}) {
  const actions = buildDriveFileActions(
    labels,
    {
      isStarred,
      inTrash,
      isFolder: file.kind === "folder",
      canOpen,
      canDownload: file.kind !== "folder",
      canShare,
      canManageStructure,
    },
    {
      onOpen,
      onDownload: () => onDownload(file),
      onStar,
      onRename,
      onMove,
      onDelete,
      onShare,
    },
  );
  // A placeholder is not on the server yet: its own actions, the rest disabled.
  const merged = file.upload
    ? file.kind === "folder"
      ? driveUploadPlaceholderMenu(labels, extraActions, undefined, {
          onOpen: canOpen ? onOpen : undefined,
        })
      : driveUploadPlaceholderMenu(labels, extraActions, () => onDownload(file))
    : extraActions?.length
      ? [...actions, ...extraActions]
      : actions;
  if (merged.length === 0) return null;
  return <DriveFileItemActionsMenu actions={merged} disabled={disabled} />;
}
