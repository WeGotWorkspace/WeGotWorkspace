import { useMemo } from "react";
import { Download, FolderInput, Star, Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { WorkspaceActionButton } from "@/hooks/workspace-list-controller-types";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";

type UseDriveSelectionBarArgs = {
  labels: DriveUILabels;
  files: DriveFile[];
  selectedIds: string[];
  selectionMode: boolean;
  activeId: string | null;
  inTrashView: boolean;
  operations?: DriveAPIOperations;
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
  exitSelection,
  batchStar,
  requestDeleteSelected,
  requestMoveSelected,
}: UseDriveSelectionBarArgs) {
  const { show, showError } = useAppToast();

  const selectionActionButtons = useMemo<WorkspaceActionButton[]>(() => {
    const downloadable =
      selectedIds.length === 1
        ? files.find((file) => file.id === selectedIds[0] && file.kind !== "folder")
        : undefined;
    const canDownload = !!downloadable && (!operations || !!downloadable.apiPath);

    return [
      {
        label: labels.selectionStar,
        icon: <Star className="size-4" />,
        onClick: batchStar,
      },
      {
        label: labels.selectionMove,
        icon: <FolderInput className="size-4" />,
        onClick: requestMoveSelected,
      },
      ...(canDownload
        ? [
            {
              label: labels.selectionDownload,
              icon: <Download className="size-4" />,
              onClick: () => {
                if (operations && downloadable.apiPath) {
                  void operations.downloadFile(downloadable.apiPath).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    showError(message);
                  });
                }
                show("Download started", { icon: <Download className="size-4" /> });
              },
            },
          ]
        : []),
      {
        label: inTrashView ? labels.selectionDeletePermanently : labels.selectionMoveToTrash,
        icon: <Trash2 className="size-4" />,
        onClick: requestDeleteSelected,
        severity: "danger",
      },
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
