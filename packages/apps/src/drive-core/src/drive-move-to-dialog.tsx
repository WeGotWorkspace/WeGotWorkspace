import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { cn } from "@/lib/utils";
import { resolveDriveFolderPickerStartPath } from "@/drive-core/src/drive-folder-picker-utils";
import { DriveFolderPicker } from "@/drive-core/src/drive-folder-picker";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

type DriveMoveToDialogShared = {
  open: boolean;
  labels: DriveUILabels;
  files: DriveFile[];
  groupPaths: string[];
  view: ViewKey;
  operations?: DriveAPIOperations;
  currentUsername: string;
  groupRootNames: Set<string>;
  /** Optional UI-path → display label for drive roots (Docs: Personal / principal names). */
  rootLabels?: Readonly<Record<string, string>>;
  /** Optional icon for drive-root rows (Docs: HardDrive). */
  rootIcon?: ReactNode;
  /** Portaled dialog theme class (repeat app accent tokens outside the workspace root). */
  dialogSurfaceClassName?: string;
  /** Docs image-insert file-select: Docs blue listing chrome (not Drive green). */
  listingTheme?: "docs";
  onClose: () => void;
};

export type DriveMoveToDialogProps = DriveMoveToDialogShared &
  (
    | {
        mode?: "folder-destination";
        moveIds: string[];
        singleItemParent?: string;
        onConfirm: (destinationPath: string) => void;
      }
    | {
        mode: "file-select";
        moveIds?: string[];
        singleItemParent?: string;
        onSelectFile: (file: DriveFile) => void;
      }
  );

export function DriveMoveToDialog(props: DriveMoveToDialogProps) {
  const {
    open,
    labels,
    files,
    groupPaths,
    view,
    operations,
    currentUsername,
    groupRootNames,
    rootLabels,
    rootIcon,
    dialogSurfaceClassName = "drive-dialog-surface",
    listingTheme,
    onClose,
  } = props;
  const fileSelect = props.mode === "file-select";
  const docsListingTheme =
    listingTheme ??
    (fileSelect && dialogSurfaceClassName.includes("docs-dialog-surface") ? "docs" : undefined);
  const moveIds = fileSelect ? [] : props.moveIds;
  const singleItemParent = props.singleItemParent;
  const onConfirm = fileSelect ? undefined : props.onConfirm;
  const onSelectFile = fileSelect ? props.onSelectFile : undefined;
  const initialBrowsePath = resolveDriveFolderPickerStartPath(view, singleItemParent);
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);

  const handleDestinationChange = useCallback((path: string | null) => {
    setDestinationPath(path);
  }, []);

  const handleSelectedFileChange = useCallback((file: DriveFile | null) => {
    setSelectedFile(file);
  }, []);

  const title = fileSelect ? labels.fileSelectDialogTitle : labels.moveDialogTitle;
  const description = fileSelect
    ? labels.fileSelectDialogDescription
    : labels.moveDialogDescription;
  const confirmDisabled = fileSelect ? selectedFile == null : !destinationPath;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn(dialogSurfaceClassName, fileSelect ? "sm:max-w-2xl" : "sm:max-w-lg")}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {open ? (
          <DriveFolderPicker
            key={`${initialBrowsePath}::${fileSelect ? "file-select" : "folder-destination"}`}
            mode={fileSelect ? "file-select" : "folder-destination"}
            labels={labels}
            files={files}
            groupPaths={groupPaths}
            moveIds={moveIds}
            initialBrowsePath={initialBrowsePath}
            operations={operations}
            currentUsername={currentUsername}
            groupRootNames={groupRootNames}
            rootLabels={rootLabels}
            rootIcon={rootIcon}
            listingTheme={docsListingTheme}
            onDestinationChange={handleDestinationChange}
            onSelectedFileChange={handleSelectedFileChange}
          />
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {labels.moveDialogCancel}
          </Button>
          {fileSelect ? (
            <Button
              variant="primary"
              disabled={confirmDisabled}
              onClick={() => {
                if (!selectedFile) return;
                onSelectFile?.(selectedFile);
              }}
            >
              {labels.fileSelectDialogInsert}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={confirmDisabled}
              onClick={() => {
                if (!destinationPath) return;
                onConfirm?.(destinationPath);
              }}
            >
              {labels.moveDialogConfirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
