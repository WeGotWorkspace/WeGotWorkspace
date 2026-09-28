import { useEffect, useMemo, useRef } from "react";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { useDriveController } from "@/drive-core/src/use-drive-controller";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";

export type DrivePaneStoryHarnessOptions = {
  listLoading?: boolean;
  filesOverride?: DriveFile[];
  viewPath?: string;
  operations?: DriveAPIOperations;
};

/** Doc row the delete-trash modal preset confirms. */
export function driveModalTrashSampleFile(): DriveFile {
  return DRIVE_MOCK_FILES.find((file) => file.kind === "doc") ?? DRIVE_MOCK_FILES[0]!;
}

export type DriveModalStoryPreset = "newFolder" | "rename" | "deleteTrash" | "deletePermanent";

export function useDrivePaneStoryController(options?: DrivePaneStoryHarnessOptions) {
  const bootstrap = useMemo(() => createDriveAppBootstrap(), []);

  const controller = useDriveController({
    data: bootstrap.data,
    session: bootstrap.session,
    operations: options?.operations,
    listLoading: options?.listLoading ?? false,
  });

  const { setFiles, setView } = controller;
  const lastFilesOverrideKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const filesOverride = options?.filesOverride;
    if (!filesOverride) return;
    const key = filesOverride.map((file) => file.id).join("|");
    if (lastFilesOverrideKeyRef.current === key) return;
    lastFilesOverrideKeyRef.current = key;
    setFiles(filesOverride);
  }, [options?.filesOverride, setFiles]);

  useEffect(() => {
    if (options?.viewPath) {
      setView({ type: "folder", path: options.viewPath });
    }
  }, [options?.viewPath, setView]);

  return controller;
}

export function useDriveModalStoryController(
  preset: DriveModalStoryPreset,
  operations?: DriveAPIOperations,
) {
  const controller = useDrivePaneStoryController(
    operations ? { operations, filesOverride: DRIVE_MOCK_FILES } : undefined,
  );
  const { setNewFolderDialogOpen, setRenameDialog, setRenameName, setConfirmDelete } = controller;

  useEffect(() => {
    setNewFolderDialogOpen(false);
    setRenameDialog(null);
    setRenameName("");
    setConfirmDelete(null);

    const sample = driveModalTrashSampleFile();

    switch (preset) {
      case "newFolder":
        setNewFolderDialogOpen(true);
        break;
      case "rename": {
        const isFolder = sample.kind === "folder";
        const lastDot = sample.title.lastIndexOf(".");
        const hasExtension = !isFolder && lastDot > 0;
        setRenameDialog({
          id: sample.id,
          extension: hasExtension ? sample.title.slice(lastDot) : "",
        });
        setRenameName(hasExtension ? sample.title.slice(0, lastDot) : sample.title);
        break;
      }
      case "deleteTrash":
        setConfirmDelete({ ids: [sample.id], permanent: false });
        break;
      case "deletePermanent":
        setConfirmDelete({
          ids: DRIVE_MOCK_FILES.slice(0, 2).map((file) => file.id),
          permanent: true,
        });
        break;
    }
  }, [preset, setConfirmDelete, setNewFolderDialogOpen, setRenameDialog, setRenameName]);

  return controller;
}
