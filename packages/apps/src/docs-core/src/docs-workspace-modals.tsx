import { Button } from "@/button/src/button";
import { RenameFilenameField } from "@/dialogs/src/rename-filename-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import type { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import type { useDocsController } from "@/docs-core/src/use-docs-controller";
import { ShareDialog } from "@/share-ui/share-dialog";

type DocsController = ReturnType<typeof useDocsController>;
type DocsShareDialog = ReturnType<typeof useDriveShareDialog>;

type DocsWorkspaceModalsProps = {
  controller: DocsController;
  shareOperations?: DriveShareOperations;
  shareDialog: DocsShareDialog;
};

export function DocsWorkspaceModals({
  controller,
  shareOperations,
  shareDialog,
}: DocsWorkspaceModalsProps) {
  const {
    labels,
    renameDialogOpen,
    renameName,
    setRenameName,
    renameExtension,
    renamePending,
    closeRenameDialog,
    submitRename,
  } = controller;

  const canSubmitRename = renameName.trim().length > 0;

  return (
    <>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent className="docs-dialog-surface sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.renameDialogTitle}</DialogTitle>
            <DialogDescription>{labels.renameDialogDescription}</DialogDescription>
          </DialogHeader>
          <RenameFilenameField
            autoFocus
            placeholder={labels.rename}
            baseName={renameName}
            extension={renameExtension || undefined}
            disabled={renamePending}
            onBaseNameChange={setRenameName}
            onEnter={() => void submitRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog} disabled={renamePending}>
              {labels.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitRename()}
              disabled={renamePending || !canSubmitRename}
            >
              {labels.renameAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shareOperations ? (
        <ShareDialog
          path={shareDialog.shareDialog.path}
          title={shareDialog.shareDialog.title}
          open={shareDialog.shareDialog.open}
          onOpenChange={shareDialog.handleShareDialogOpenChange}
          shareOperations={shareOperations}
          dialogSurfaceClassName="docs-dialog-surface"
        />
      ) : null}
    </>
  );
}
