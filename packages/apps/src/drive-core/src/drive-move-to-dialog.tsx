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
import {
  drivePickerListingTheme,
  resolveDriveFolderPickerStartPath,
} from "@/drive-core/src/drive-folder-picker-utils";
import { DrivePickerNewFolderButton } from "@/drive-core/src/drive-picker-new-folder";
import type { DrivePickerNewFolderControl } from "@/drive-core/src/drive-picker-new-folder-utils";
import { DriveFolderPicker } from "@/drive-core/src/drive-folder-picker";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations, DriveShareOperations } from "@/lib/files/drive-types";

type DriveMoveToDialogShared = {
  open: boolean;
  labels: DriveUILabels;
  files: DriveFile[];
  groupPaths: string[];
  view: ViewKey;
  operations?: DriveAPIOperations;
  shareOperations?: Pick<DriveShareOperations, "getAtPath">;
  currentUsername: string;
  groupRootNames: Set<string>;
  /** Optional UI-path → display label for drive roots (Docs: Personal / principal names). */
  rootLabels?: Readonly<Record<string, string>>;
  /** Portaled dialog theme class (repeat app accent tokens outside the workspace root). */
  dialogSurfaceClassName?: string;
  /** Docs chrome on the listing; defaults from `dialogSurfaceClassName`. */
  listingTheme?: "docs";
  /** Extra action pinned to the footer's start, e.g. Docs' image *Upload*. */
  footerStart?: ReactNode;
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
    shareOperations,
    currentUsername,
    groupRootNames,
    rootLabels,
    dialogSurfaceClassName = "drive-dialog-surface",
    listingTheme,
    footerStart,
    onClose,
  } = props;
  const fileSelect = props.mode === "file-select";
  const docsListingTheme = listingTheme ?? drivePickerListingTheme(dialogSurfaceClassName);
  const moveIds = fileSelect ? [] : props.moveIds;
  const singleItemParent = props.singleItemParent;
  const onConfirm = fileSelect ? undefined : props.onConfirm;
  const onSelectFile = fileSelect ? props.onSelectFile : undefined;
  const initialBrowsePath = resolveDriveFolderPickerStartPath(view, singleItemParent);
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [newFolder, setNewFolder] = useState<DrivePickerNewFolderControl | null>(null);

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
        className={dialogSurfaceClassName}
        // Escape in the folder-name field drops that row, not the dialog.
        onEscapeKeyDown={(event) => {
          if (newFolder?.active) event.preventDefault();
        }}
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
            shareOperations={shareOperations}
            currentUsername={currentUsername}
            groupRootNames={groupRootNames}
            rootLabels={rootLabels}
            listingTheme={docsListingTheme}
            onDestinationChange={handleDestinationChange}
            onSelectedFileChange={handleSelectedFileChange}
            onNewFolderChange={setNewFolder}
          />
        ) : null}

        <DialogFooter>
          {footerStart ? <div className="mr-auto">{footerStart}</div> : null}
          {fileSelect ? null : (
            <div className="mr-auto">
              <DrivePickerNewFolderButton labels={labels} control={newFolder} />
            </div>
          )}
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
              disabled={confirmDisabled || Boolean(newFolder?.creating)}
              onClick={() => {
                if (!destinationPath || newFolder?.creating) return;
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
