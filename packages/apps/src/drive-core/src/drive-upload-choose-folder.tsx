import { useCallback, useState } from "react";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { apiPathFromUiPath } from "@/drive-core/src/drive-path-utils";
import { driveUploadIssueLabels as L } from "@/drive-core/src/drive-upload-issue-labels";
import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";
import type { DriveControllerState } from "@/drive-core/src/use-drive-controller";

type ChooseFolderController = Pick<
  DriveControllerState,
  | "labels"
  | "files"
  | "sidebarGroupPaths"
  | "view"
  | "operations"
  | "currentUsername"
  | "groupRootNames"
  | "folderPickerRootLabels"
>;

/**
 * *Choose another folder* on a file whose folder is gone or no longer
 * writable (#1522): the folder picker of *Move to*, with its own title and
 * button. The file keeps its stored bytes and goes back to the queue.
 */
export function useDriveUploadChooseFolder(
  controller: ChooseFolderController,
  snapshot: DriveUploadQueueSnapshot | null,
  show: (message: string) => void,
  showError: (message: string) => void,
  retarget = controller.operations?.retargetQueuedUpload,
) {
  const [itemId, setItemId] = useState<string | null>(null);
  const item = itemId ? snapshot?.items.find((candidate) => candidate.id === itemId) : undefined;
  const choose = useCallback((id: string) => setItemId(id), []);
  const close = () => setItemId(null);

  const confirm = (uiPath: string) => {
    close();
    if (!item || !retarget) return;
    const cwd = apiPathFromUiPath(uiPath, controller.currentUsername, controller.groupRootNames);
    const folder = uiPath.split("/").filter(Boolean).at(-1) ?? uiPath;
    void retarget(item.id, cwd)
      .then((moved) => {
        if (moved) show(L.chooseFolderDone(item.name, folder));
      })
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  };

  const dialog = item ? (
    <DriveMoveToDialog
      open
      labels={{
        ...controller.labels,
        moveDialogTitle: L.chooseFolderTitle(item.name),
        moveDialogDescription: L.chooseFolderDescription,
        moveDialogConfirm: L.chooseFolderConfirm,
      }}
      files={controller.files}
      groupPaths={controller.sidebarGroupPaths}
      moveIds={[]}
      view={controller.view}
      operations={controller.operations}
      currentUsername={controller.currentUsername}
      groupRootNames={controller.groupRootNames}
      rootLabels={controller.folderPickerRootLabels}
      onClose={close}
      onConfirm={confirm}
    />
  ) : null;

  return { choose: retarget ? choose : undefined, dialog };
}
