import { Button, buttonVariants } from "@/button/src/button";
import { Input } from "@/ui/input";
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
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { DriveCreateMarkdownDialog } from "@/drive-core/src/drive-create-markdown-dialog";
import { ShareDialog } from "@/share-ui/share-dialog";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import type { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import type { useDriveController } from "@/drive-core/src/use-drive-controller";

type DriveController = ReturnType<typeof useDriveController>;
type DriveShareDialog = ReturnType<typeof useDriveShareDialog>;

type DriveWorkspaceModalsProps = {
  controller: DriveController;
  shareOperations?: DriveShareOperations;
  shareDialog: DriveShareDialog;
};

export function DriveWorkspaceModals({
  controller,
  shareOperations,
  shareDialog,
}: DriveWorkspaceModalsProps) {
  const {
    labels,
    newFolderDialogOpen,
    setNewFolderDialogOpen,
    newFolderName,
    setNewFolderName,
    submitCreateFolder,
    renameDialog,
    setRenameDialog,
    renameName,
    setRenameName,
    submitRenameItem,
    fileById,
    confirmDelete,
    setConfirmDelete,
    reallyDelete,
    moveToTrash,
    moveDialog,
    setMoveDialog,
    markdownDialogOpen,
    markdownDialogDefaults,
    markdownDialogSubmitting,
    markdownDialogError,
    closeMarkdownDialog,
    submitCreateMarkdown,
    files,
    sidebarGroupPaths,
    commitMoveToFolder,
    view,
    operations,
    currentUsername,
    groupRootNames,
  } = controller;

  const renameTarget = renameDialog ? fileById(renameDialog.id) : null;
  const renameExtension = renameDialog?.extension || undefined;
  const canSubmitRename = renameName.trim().length > 0;

  return (
    <>
      <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <DialogContent className="drive-dialog-surface">
          <DialogHeader>
            <DialogTitle>Create new folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCreateFolder();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitCreateFolder} disabled={!newFolderName.trim()}>
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renameDialog}
        onOpenChange={(open) => {
          if (!open) {
            setRenameDialog(null);
            setRenameName("");
          }
        }}
      >
        <DialogContent className="drive-dialog-surface">
          <DialogHeader>
            <DialogTitle>{labels.renameDialogTitle}</DialogTitle>
            <DialogDescription>
              {renameTarget?.kind === "folder"
                ? labels.renameDialogDescriptionFolder
                : labels.renameDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <RenameFilenameField
            autoFocus
            placeholder="Name"
            baseName={renameName}
            extension={renameExtension}
            onBaseNameChange={setRenameName}
            onEnter={submitRenameItem}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialog(null);
                setRenameName("");
              }}
            >
              {labels.cancel}
            </Button>
            <Button variant="primary" onClick={submitRenameItem} disabled={!canSubmitRename}>
              {labels.renameAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.permanent ? "Delete permanently?" : "Move to Trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.permanent
                ? `This will permanently delete ${confirmDelete?.ids.length} file${
                    confirmDelete && confirmDelete.ids.length === 1 ? "" : "s"
                  }. This cannot be undone.`
                : `This will move ${confirmDelete?.ids.length} file${
                    confirmDelete && confirmDelete.ids.length === 1 ? "" : "s"
                  } to Trash.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (confirmDelete) {
                  if (confirmDelete.permanent) reallyDelete(confirmDelete.ids);
                  else moveToTrash(confirmDelete.ids);
                }
                setConfirmDelete(null);
              }}
            >
              {confirmDelete?.permanent ? "Delete" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DriveMoveToDialog
        open={!!moveDialog}
        labels={controller.labels}
        files={files}
        groupPaths={sidebarGroupPaths}
        moveIds={moveDialog?.ids ?? []}
        view={view}
        singleItemParent={
          moveDialog?.ids.length === 1 ? fileById(moveDialog.ids[0]!)?.parent : undefined
        }
        operations={operations}
        currentUsername={currentUsername}
        groupRootNames={groupRootNames}
        onClose={() => setMoveDialog(null)}
        onConfirm={(destinationPath) => {
          if (moveDialog) commitMoveToFolder(moveDialog.ids, destinationPath);
          setMoveDialog(null);
        }}
      />

      <DriveCreateMarkdownDialog
        open={markdownDialogOpen}
        labels={labels}
        defaultName={markdownDialogDefaults.defaultName}
        initialBrowsePath={markdownDialogDefaults.initialBrowsePath}
        files={files}
        groupPaths={sidebarGroupPaths}
        view={view}
        operations={operations}
        currentUsername={currentUsername}
        groupRootNames={groupRootNames}
        isSubmitting={markdownDialogSubmitting}
        errorMessage={markdownDialogError}
        onClose={closeMarkdownDialog}
        onConfirm={submitCreateMarkdown}
      />

      {shareOperations ? (
        <ShareDialog
          path={shareDialog.shareDialog.path}
          title={shareDialog.shareDialog.title}
          open={shareDialog.shareDialog.open}
          onOpenChange={shareDialog.handleShareDialogOpenChange}
          onOpenAccess={shareDialog.handleShareDialogOpenAccess}
          shareOperations={shareOperations}
        />
      ) : null}
    </>
  );
}
