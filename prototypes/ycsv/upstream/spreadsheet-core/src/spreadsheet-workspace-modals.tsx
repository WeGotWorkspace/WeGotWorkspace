import { useEffect, useState } from "react";
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
import { Input } from "@/ui/input";
import type { SpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";

export function SpreadsheetWorkspaceModals({ controller }: { controller: SpreadsheetController }) {
  const {
    labels,
    renameDialogOpen,
    renameName,
    setRenameName,
    renameExtension,
    renamePending,
    closeRenameDialog,
    submitRename,
    sheetRenameDialog,
    closeSheetRenameDialog,
    renameSheet,
  } = controller;

  const canSubmitRename = renameName.trim().length > 0;
  const [sheetRenameValue, setSheetRenameValue] = useState("");
  useEffect(() => {
    if (sheetRenameDialog) setSheetRenameValue(sheetRenameDialog.name);
  }, [sheetRenameDialog]);
  const canSubmitSheetRename = sheetRenameValue.trim().length > 0;

  return (
    <>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent className="spreadsheet-dialog-surface sm:max-w-md">
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

      <Dialog
        open={sheetRenameDialog !== null}
        onOpenChange={(open) => {
          if (!open) closeSheetRenameDialog();
        }}
      >
        <DialogContent className="spreadsheet-dialog-surface sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.renameSheetDialogTitle}</DialogTitle>
            <DialogDescription>{labels.renameSheetDialogDescription}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!sheetRenameDialog || !canSubmitSheetRename) return;
              renameSheet(sheetRenameDialog.index, sheetRenameValue);
              closeSheetRenameDialog();
            }}
          >
            <Input
              autoFocus
              value={sheetRenameValue}
              onChange={(e) => setSheetRenameValue(e.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={closeSheetRenameDialog}>
                {labels.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={!canSubmitSheetRename}>
                {labels.renameSheetAction}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
