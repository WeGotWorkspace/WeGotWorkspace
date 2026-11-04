import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveFileMenuAction } from "@/drive-core/src/drive-file-actions";

/** Actions that need the file on the server. */
const NEEDS_SERVER = new Set(["open", "download", "rename", "move", "share"]);
const noop = () => {};

/**
 * Menu of an upload placeholder: its own actions (*Retry*, *Remove*) first,
 * then the actions that need the file on the server, disabled with a reason.
 * *Download* works when `onDownload` is given: it saves this device's copy.
 * A folder placeholder (#1620) has no *Download*, and *Open* works when
 * `onOpen` is given: it lists the files queued inside.
 */
export function driveUploadPlaceholderMenu(
  labels: DriveUILabels,
  ownActions: readonly ActionBarAction[] = [],
  onDownload?: () => void,
  folder?: { onOpen?: () => void },
): DriveFileMenuAction[] {
  const onOpen = folder?.onOpen;
  const serverActions = buildDriveFileActions(
    labels,
    {
      isStarred: false,
      inTrash: false,
      isFolder: folder !== undefined,
      canOpen: true,
      canDownload: folder === undefined,
      canShare: true,
    },
    {
      onOpen: onOpen ?? noop,
      onDownload: onDownload ?? noop,
      onStar: noop,
      onRename: noop,
      onMove: noop,
      onDelete: noop,
      onShare: noop,
    },
  )
    .filter((action) => action.id && NEEDS_SERVER.has(action.id))
    .map((action) =>
      (action.id === "download" && onDownload) || (action.id === "open" && onOpen)
        ? action
        : {
            ...action,
            onClick: undefined,
            disabled: true,
            description: labels.uploadActionUnavailable,
          },
    );
  return [...ownActions, ...serverActions];
}
