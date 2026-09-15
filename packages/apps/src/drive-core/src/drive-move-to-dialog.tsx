import { useCallback, useRef, useState, type ReactNode } from "react";
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
        onUploadFiles?: (files: File[]) => void;
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
    onClose,
  } = props;
  const fileSelect = props.mode === "file-select";
  const moveIds = fileSelect ? [] : props.moveIds;
  const singleItemParent = props.singleItemParent;
  const onConfirm = fileSelect ? undefined : props.onConfirm;
  const onSelectFile = fileSelect ? props.onSelectFile : undefined;
  const onUploadFiles = fileSelect ? props.onUploadFiles : undefined;
  const initialBrowsePath = resolveDriveFolderPickerStartPath(view, singleItemParent);
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

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
            onDestinationChange={handleDestinationChange}
            onSelectedFileChange={handleSelectedFileChange}
          />
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {labels.moveDialogCancel}
          </Button>
          {fileSelect ? (
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
                    onUploadFiles?.(Array.from(chosen));
                  }
                  event.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
                {labels.fileSelectDialogUpload}
              </Button>
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
            </>
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
