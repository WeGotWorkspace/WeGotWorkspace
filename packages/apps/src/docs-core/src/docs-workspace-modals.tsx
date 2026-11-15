import { RenameFileDialog } from "@/dialogs/src/rename-file-dialog";
import type { DriveShareOperations } from "@/lib/files/drive-types";
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

  return (
    <>
      <RenameFileDialog
        open={renameDialogOpen}
        title={labels.renameDialogTitle}
        description={labels.renameDialogDescription}
        placeholder={labels.rename}
        cancelLabel={labels.cancel}
        confirmLabel={labels.renameAction}
        baseName={renameName}
        extension={renameExtension}
        busy={renamePending}
        surfaceClassName="docs-dialog-surface"
        onBaseNameChange={setRenameName}
        onClose={closeRenameDialog}
        onSubmit={() => void submitRename()}
      />

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
