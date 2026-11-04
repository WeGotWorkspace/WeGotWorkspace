import { MoreHorizontal } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { DriveItemIconButton } from "@/drive-core/src/drive-item-icon-button";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import { useCanDownloadDriveItem } from "@/drive-core/src/drive-item-download";
import { driveUploadPlaceholderMenu } from "@/drive-core/src/drive-upload-placeholder-menu";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";

/** A row menu action; `description` explains a disabled one. */
export type DriveFileMenuAction = ActionBarAction & { description?: string };

/** A row menu entry: an action or a divider between groups. */
export type DriveFileMenuEntry = DriveFileMenuAction | { type: "separator"; id: string };

/**
 * The row menu in three groups: *Open* first, *Delete* last, the rest in
 * between in alphabetical order.
 */
export function segmentDriveFileMenu(actions: DriveFileMenuAction[]): DriveFileMenuEntry[] {
  const first = actions.filter((action) => action.id === "open");
  const last = actions.filter((action) => action.id === "delete");
  const middle = actions
    .filter((action) => action.id !== "open" && action.id !== "delete")
    .sort((a, b) => a.label.localeCompare(b.label));
  const groups = [first, middle, last].filter((group) => group.length > 0);
  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ type: "separator" as const, id: `separator-${index}` }, ...group],
  );
}

export function DriveFileItemActionsMenu({
  actions,
  disabled = false,
}: {
  actions: DriveFileMenuEntry[];
  disabled?: boolean;
}) {
  return (
    <DropdownMenu
      align="end"
      sideOffset={6}
      contentClassName="min-w-40"
      items={actions.map((action): DropdownMenuEntry =>
        "type" in action
          ? action
          : {
              id: action.id,
              label: action.label,
              ...(action.description ? { description: action.description } : {}),
              icon: action.icon,
              onClick: action.onClick,
              checked: action.active,
              disabled: disabled || action.disabled,
              severity:
                action.severity === "danger" || action.id === "delete"
                  ? ("danger" as const)
                  : undefined,
              className: "cursor-pointer gap-2.5",
            },
      )}
      trigger={
        <DriveItemIconButton
          label="More actions"
          icon={<MoreHorizontal />}
          showTooltip={false}
          disabled={disabled}
        />
      }
    />
  );
}

/** The row menu of one grid tile or list row. */
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
      canDownload: useCanDownloadDriveItem(file, inTrash),
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
    ? driveUploadPlaceholderMenu(labels, extraActions, () => onDownload(file))
    : segmentDriveFileMenu([...actions, ...(extraActions ?? [])]);
  if (merged.length === 0) return null;
  return <DriveFileItemActionsMenu actions={merged} disabled={disabled} />;
}
