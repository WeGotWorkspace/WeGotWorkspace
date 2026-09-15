import { useMemo } from "react";
import { HardDrive } from "lucide-react";
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
  const groupPaths = useMemo(() => groupRoots.map((root) => `Groups/${root.slug}`), [groupRoots]);
  const groupRootNames = useMemo(() => new Set(groupRoots.map((root) => root.slug)), [groupRoots]);
  const rootLabels = useMemo(
    () => buildDocsFolderPickerRootLabels(groupRoots, docsLabels.homeMyDrive),
    [groupRoots],
  );
  const pickerLabels = useMemo(
    () => ({ ...driveLabels, sidebarMyDrive: docsLabels.homeMyDrive }),
    [],
  );
  const rootIcon = useMemo(() => <HardDrive />, []);

  return (
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
      rootIcon={rootIcon}
      dialogSurfaceClassName="docs-dialog-surface"
      onClose={onClose}
      onSelectFile={onSelectFile}
      onUploadFiles={onUploadFiles}
    />
  );
}
