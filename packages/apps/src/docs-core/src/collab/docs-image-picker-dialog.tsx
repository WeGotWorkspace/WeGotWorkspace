import { useMemo, useRef } from "react";
import { Button } from "@/button/src/button";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { driveGroupUiPath } from "@/lib/files/drive-path-utils";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { DriveFile } from "@/lib/files/drive-models";
import {
  buildDocsFolderPickerRootLabels,
  DOCS_DRIVE_UI_PERSONAL_PATH,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";
import { docsLabels } from "@/docs-core/src/docs-labels";

export type DocsImagePickerDialogProps = {
  open: boolean;
  operations?: DriveAPIOperations;
  currentUsername: string;
  groupRoots: readonly DocsHomeGroupRoot[];
  onClose: () => void;
  onSelectFile: (file: DriveFile) => void;
  onUploadFiles: (files: File[]) => void;
};

export function DocsImagePickerDialog({
  open,
  operations,
  currentUsername,
  groupRoots,
  onClose,
  onSelectFile,
  onUploadFiles,
}: DocsImagePickerDialogProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const groupPaths = useMemo(
    () => groupRoots.map((root) => driveGroupUiPath(root.slug)),
    [groupRoots],
  );
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
      fileSelectDialogDescription: docsLabels.insertImageChooserDescription,
    }),
    [],
  );

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

      <DriveMoveToDialog
        mode="file-select"
        open={open}
        labels={pickerLabels}
        files={[]}
        groupPaths={groupPaths}
        view={{ type: "folder", path: DOCS_DRIVE_UI_PERSONAL_PATH }}
        operations={operations}
        currentUsername={currentUsername}
        groupRootNames={groupRootNames}
        rootLabels={rootLabels}
        dialogSurfaceClassName="docs-dialog-surface"
        listingTheme="docs"
        footerStart={
          <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
            {docsLabels.insertImageUpload}
          </Button>
        }
        onClose={onClose}
        onSelectFile={onSelectFile}
      />
    </>
  );
}
