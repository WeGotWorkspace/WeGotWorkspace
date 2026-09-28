import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import { Button, buttonVariants } from "@/button/src/button";
import { RenameFilenameField } from "@/dialogs/src/rename-filename-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { DriveCreateMarkdownDialog } from "@/drive-core/src/drive-create-markdown-dialog";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeActions } from "@/docs-core/src/use-docs-home-actions";
import type { DocsHomeCreateDialogState } from "@/docs-core/src/use-docs-home-create-dialog";
import {
  buildDocsFolderPickerRootLabels,
  DOCS_DRIVE_UI_PERSONAL_PATH,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";

type DocsHomeModalsProps = {
  actions: DocsHomeActions;
  labels: DocsUILabels;
  files: DriveFile[];
  username: string;
  /** Labeled group roots (SST) — slugs for paths, labels for picker chrome. */
  groupRoots: readonly DocsHomeGroupRoot[];
  operations?: DriveAPIOperations;
  createDialog?: DocsHomeCreateDialogState;
};

export function DocsHomeModals({
  actions,
  labels,
  files,
  username,
  groupRoots,
  operations,
  createDialog,
}: DocsHomeModalsProps) {
  const {
    renameState,
    renameName,
    setRenameName,
    submitRename,
    closeRename,
    moveState,
    closeMove,
    confirmMove,
    deleteState,
    closeDelete,
    confirmTrash,
  } = actions;

  const groupPaths = useMemo(() => groupRoots.map((root) => `Groups/${root.slug}`), [groupRoots]);
  const groupRootNames = useMemo(() => new Set(groupRoots.map((root) => root.slug)), [groupRoots]);
  const folderPickerRootLabels = useMemo(
    () => buildDocsFolderPickerRootLabels(groupRoots, labels.homeMyDrive),
    [groupRoots, labels.homeMyDrive],
  );
  const folderPickerRootIcon = useMemo(() => <HardDrive />, []);
  const moveTarget = moveState ? actions.fileById(moveState.ids[0]!) : null;
  const canSubmitRename = renameName.trim().length > 0;

  return (
    <>
      <Dialog open={!!renameState} onOpenChange={(open) => !open && closeRename()}>
        <DialogContent className="docs-dialog-surface">
          <DialogHeader>
            <DialogTitle>{labels.renameDialogTitle}</DialogTitle>
            <DialogDescription>{labels.renameDialogDescription}</DialogDescription>
          </DialogHeader>
          <RenameFilenameField
            autoFocus
            placeholder="Name"
            baseName={renameName}
            extension={renameState?.extension || undefined}
            onBaseNameChange={setRenameName}
            onEnter={submitRename}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeRename}>
              {labels.cancel}
            </Button>
            <Button variant="primary" onClick={submitRename} disabled={!canSubmitRename}>
              {labels.renameAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteState} onOpenChange={(open) => !open && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState?.permanent
                ? labels.homeDeletePermanentlyTitle
                : labels.homeMoveToTrashTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteState?.permanent
                ? deleteState.ids.length === 1
                  ? labels.homeDeletePermanentlyOne
                  : labels.homeDeletePermanentlyMany(deleteState.ids.length)
                : deleteState && deleteState.ids.length === 1
                  ? labels.homeMoveToTrashOne
                  : labels.homeMoveToTrashMany(deleteState?.ids.length ?? 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={confirmTrash}
            >
              {deleteState?.permanent
                ? labels.homeDeletePermanentlyAction
                : labels.homeMoveToTrashAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DriveMoveToDialog
        open={!!moveState}
        labels={driveLabels}
        files={files}
        groupPaths={groupPaths}
        moveIds={moveState?.ids ?? []}
        view={{ type: "folder", path: DOCS_DRIVE_UI_PERSONAL_PATH }}
        singleItemParent={moveTarget?.parent}
        operations={operations}
        currentUsername={username}
        groupRootNames={groupRootNames}
        rootLabels={folderPickerRootLabels}
        rootIcon={folderPickerRootIcon}
        dialogSurfaceClassName="docs-dialog-surface"
        onClose={closeMove}
        onConfirm={confirmMove}
      />

      {createDialog ? (
        <DriveCreateMarkdownDialog
          open={createDialog.createDialogOpen}
          labels={driveLabels}
          defaultName={createDialog.createDialogDefaultName}
          initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
          initialSelectedPath={createDialog.createDialogBrowsePath}
          files={files}
          groupPaths={groupPaths}
          view={createDialog.createDialogView}
          operations={operations}
          currentUsername={username}
          groupRootNames={groupRootNames}
          rootLabels={folderPickerRootLabels}
          rootIcon={folderPickerRootIcon}
          dialogSurfaceClassName="docs-dialog-surface"
          onClose={createDialog.closeCreateDialog}
          onConfirm={createDialog.confirmCreateDocument}
        />
      ) : null}
    </>
  );
}
