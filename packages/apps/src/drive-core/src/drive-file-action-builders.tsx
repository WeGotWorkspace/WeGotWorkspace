import {
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Pencil,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

export type DriveFileActionCallbacks = {
  onDownload: () => void;
  onStar: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onShare?: () => void;
};

export function buildDriveFileActions(
  labels: DriveUILabels,
  options: {
    isStarred: boolean;
    inTrash: boolean;
    isFolder?: boolean;
    canOpen?: boolean;
    canDownload?: boolean;
    /** Full access (`mayManageStructure`). When false, omit rename / move / delete. */
    canManageStructure?: boolean;
    canMove?: boolean;
    canShare?: boolean;
  },
  callbacks: DriveFileActionCallbacks,
): ActionBarAction[] {
  const actions: ActionBarAction[] = [];
  const canManageStructure = options.canManageStructure !== false;

  if (options.canOpen !== false && callbacks.onOpen) {
    actions.push({
      id: "open",
      label: labels.detailOpen,
      onClick: callbacks.onOpen,
      icon: options.isFolder ? <FolderOpen /> : <ExternalLink />,
    });
  }

  if (options.canDownload !== false) {
    actions.push({
      id: "download",
      label: labels.detailDownload,
      onClick: callbacks.onDownload,
      icon: <Download />,
    });
  }

  actions.push({
    id: "star",
    label: options.isStarred ? labels.detailUnstar : labels.detailStar,
    onClick: callbacks.onStar,
    active: options.isStarred,
    icon: <Star />,
  });

  if (canManageStructure && callbacks.onRename) {
    actions.push({
      id: "rename",
      label: labels.detailRename,
      onClick: callbacks.onRename,
      icon: <Pencil />,
    });
  }

  if (options.canShare && callbacks.onShare) {
    actions.push({
      id: "share",
      label: labels.detailShare,
      onClick: callbacks.onShare,
      icon: <Share2 />,
    });
  }

  if (canManageStructure && options.canMove !== false && callbacks.onMove) {
    actions.push({
      id: "move",
      label: labels.detailMove,
      onClick: callbacks.onMove,
      icon: <FolderInput />,
    });
  }

  if (canManageStructure) {
    actions.push({
      id: "delete",
      label: options.inTrash ? labels.selectionDeletePermanently : labels.detailDelete,
      onClick: callbacks.onDelete,
      icon: <Trash2 />,
    });
  }

  return actions;
}
