import { useEffect, useMemo, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  buildDocsFolderPickerRootLabels,
  DOCS_DRIVE_UI_PERSONAL_PATH,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";
import { docsLabels } from "@/docs-core/src/docs-labels";
import "./docs-image-picker-dialog.css";

export type DocsImageInsertStep = "chooser" | "browse";

export type DocsImagePickerDialogProps = {
  open: boolean;
  operations?: DriveAPIOperations;
  currentUsername: string;
  groupRoots: readonly DocsHomeGroupRoot[];
  onClose: () => void;
  onSelectFile: (file: DriveFile) => void;
  onUploadFiles: (files: File[]) => void;
  /** Stories / tests: start on browse. Default is the upload-or-browse chooser. */
  initialStep?: DocsImageInsertStep;
};

export function DocsImagePickerDialog({
  open,
  operations,
  currentUsername,
  groupRoots,
  onClose,
  onSelectFile,
  onUploadFiles,
  initialStep = "chooser",
}: DocsImagePickerDialogProps) {
  const [step, setStep] = useState<DocsImageInsertStep>(initialStep);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const groupPaths = useMemo(() => groupRoots.map((root) => `Groups/${root.slug}`), [groupRoots]);
  const groupRootNames = useMemo(() => new Set(groupRoots.map((root) => root.slug)), [groupRoots]);
  const rootLabels = useMemo(
    () => buildDocsFolderPickerRootLabels(groupRoots, docsLabels.homeMyDrive),
    [groupRoots],
  );
  const pickerLabels = useMemo(
    () => ({
      ...driveLabels,
      sidebarMyDrive: docsLabels.homeMyDrive,
      fileSelectDialogTitle: docsLabels.insertImageTitle,
    }),
    [],
  );
  const rootIcon = useMemo(() => <HardDrive />, []);

  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  const chooserOpen = open && step === "chooser";
  const browseOpen = open && step === "browse";

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const chosen = event.target.files;
          if (chosen && chosen.length > 0) {
            onUploadFiles(Array.from(chosen));
          }
          event.target.value = "";
        }}
      />

      <Dialog open={chooserOpen} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="docs-dialog-surface sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{docsLabels.insertImageTitle}</DialogTitle>
            <DialogDescription>{docsLabels.insertImageChooserDescription}</DialogDescription>
          </DialogHeader>
          <div className="docs-image-insert-chooser__actions">
            <Button variant="primary" onClick={() => uploadInputRef.current?.click()}>
              {docsLabels.insertImageUpload}
            </Button>
            <Button variant="outline" onClick={() => setStep("browse")}>
              {docsLabels.insertImageChooseFromDrive}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {docsLabels.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DriveMoveToDialog
        mode="file-select"
        open={browseOpen}
        labels={pickerLabels}
        files={[]}
        groupPaths={groupPaths}
        view={{ type: "folder", path: DOCS_DRIVE_UI_PERSONAL_PATH }}
        operations={operations}
        currentUsername={currentUsername}
        groupRootNames={groupRootNames}
        rootLabels={rootLabels}
        rootIcon={rootIcon}
        dialogSurfaceClassName="docs-dialog-surface"
        listingTheme="docs"
        onClose={onClose}
        onSelectFile={onSelectFile}
      />
    </>
  );
}
