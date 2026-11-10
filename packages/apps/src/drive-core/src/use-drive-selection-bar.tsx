import { useMemo } from "react";
import { Download, FolderInput, Star, Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { WorkspaceActionButton } from "@/hooks/workspace-list-controller-types";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  canDownloadDriveItem,
  canDownloadDriveSelection,
  startDriveItemDownload,
  startDriveSelectionDownload,
} from "@/drive-core/src/drive-item-download";

type UseDriveSelectionBarArgs = {
  labels: DriveUILabels;
  /** Rows to find the selection in: from any view, not only the open folder. */
  files: DriveFile[];
  selectedIds: string[];
  selectionMode: boolean;
  activeId: string | null;
  inTrashView: boolean;
  operations?: DriveAPIOperations;
  /** False for guests: no Move or Delete (#1712). */
  structureEnabled?: boolean;
  /** Names the zip of several selected items: the place the user is looking at (#1905). */
  zipName?: string;
  exitSelection: () => void;
  batchStar: () => void;
  requestDeleteSelected: () => void;
  requestMoveSelected: () => void;
};

export function useDriveSelectionBar({
  labels,
  files,
  selectedIds,
  selectionMode,
  activeId,
  inTrashView,
  operations,
  structureEnabled = true,
  zipName,
  exitSelection,
  batchStar,
  requestDeleteSelected,
  requestMoveSelected,
}: UseDriveSelectionBarArgs) {
  const { show, showError } = useAppToast();

  const selectionActionButtons = useMemo<WorkspaceActionButton[]>(() => {
    const filesById = new Map(files.map((file) => [file.id, file]));
    const selected = selectedIds.map((id) => filesById.get(id));
    const started = () => show("Download started", { icon: <Download className="size-4" /> });
    const download =
      singleDownload(selected, operations, inTrashView, showError, started) ??
      (canDownloadDriveSelection(selected, {
        selectionDownloadable: !!operations?.downloadSelection,
        inTrash: inTrashView,
      })
        ? () =>
            startDriveSelectionDownload(
              operations,
              selected,
              zipName?.trim() || "Download",
              showError,
              started,
            )
        : null);

    const moveButton: WorkspaceActionButton = {
      label: labels.selectionMove,
      icon: <FolderInput className="size-4" />,
      onClick: requestMoveSelected,
    };
    const deleteButton: WorkspaceActionButton = {
      label: inTrashView ? labels.selectionDeletePermanently : labels.selectionMoveToTrash,
      icon: <Trash2 className="size-4" />,
      onClick: requestDeleteSelected,
      severity: "danger",
    };

    return [
      {
        label: labels.selectionStar,
        icon: <Star className="size-4" />,
        onClick: batchStar,
      },
      ...(structureEnabled ? [moveButton] : []),
      ...(download
        ? [
            {
              label: labels.selectionDownload,
              icon: <Download className="size-4" />,
              onClick: download,
            },
          ]
        : []),
      ...(structureEnabled ? [deleteButton] : []),
    ];
  }, [
    batchStar,
    files,
    inTrashView,
    labels.selectionDeletePermanently,
    labels.selectionDownload,
    labels.selectionMove,
    labels.selectionMoveToTrash,
    labels.selectionStar,
    operations,
    requestDeleteSelected,
    requestMoveSelected,
    selectedIds,
    show,
    showError,
    structureEnabled,
    zipName,
  ]);

  return useWorkspaceSelectionPresentation({
    selectedIds,
    selectionMode,
    activeId: activeId ?? "",
    exitSelection: () => exitSelection(),
    actionButtons: selectionActionButtons,
    doneLabel: labels.selectionDone,
    floatingClassName: "drive-selection-bar",
  });
}

/** *Download* for one selected item, as before #1905: a file, or a folder as a zip. */
function singleDownload(
  selected: (DriveFile | undefined)[],
  operations: DriveAPIOperations | undefined,
  inTrashView: boolean,
  showError: (message: string) => void,
  onStarted: () => void,
): (() => void) | null {
  const file = selected.length === 1 ? selected[0] : undefined;
  if (
    !file ||
    !canDownloadDriveItem(file, {
      foldersDownloadable: !!operations?.downloadFolder,
      inTrash: inTrashView,
    }) ||
    (operations && !file.apiPath)
  ) {
    return null;
  }
  return () => startDriveItemDownload(operations, file, showError, onStarted);
}
