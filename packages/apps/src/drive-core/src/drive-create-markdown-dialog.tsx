import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { RenameFilenameField } from "@/dialogs/src/rename-filename-field";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { splitMarkdownDialogDefaultName } from "@/drive-core/src/drive-create-markdown-dialog-utils";
import { DriveFolderPicker } from "@/drive-core/src/drive-folder-picker";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { joinFileNameForRename } from "@/lib/files/filename-rename";

export function DriveCreateMarkdownDialog({
  open,
  labels,
  defaultName,
  initialBrowsePath,
  initialSelectedPath,
  files,
  groupPaths,
  view: _view,
  operations,
  currentUsername,
  groupRootNames,
  rootLabels,
  rootIcon,
  isSubmitting = false,
  errorMessage,
  dialogSurfaceClassName = "drive-dialog-surface",
  onClose,
  onConfirm,
}: {
  open: boolean;
  labels: DriveUILabels;
  defaultName: string;
  initialBrowsePath: string;
  /** Optional preselected destination (Docs: sidebar drive on the Drives root listing). */
  initialSelectedPath?: string | null;
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
  isSubmitting?: boolean;
  errorMessage?: string | null;
  /** Portaled dialog theme class (repeat app accent tokens outside the workspace root). */
  dialogSurfaceClassName?: string;
  onClose: () => void;
  onConfirm: (fileName: string, destinationPath: string) => void;
}) {
  const { extension } = splitMarkdownDialogDefaultName(defaultName);
  const [draftBaseName, setDraftBaseName] = useState("");
  const [focusSession, setFocusSession] = useState<string | null>(null);
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const nextFocusSession = open ? defaultName : null;
  const pickerRemountKey = `${initialBrowsePath}::${initialSelectedPath ?? ""}`;

  if (nextFocusSession !== focusSession) {
    setFocusSession(nextFocusSession);
    if (nextFocusSession) {
      setDraftBaseName(splitMarkdownDialogDefaultName(defaultName).baseName);
      setDestinationPath(null);
    }
  }

  const handleDestinationChange = useCallback((path: string | null) => {
    setDestinationPath(path);
  }, []);

  const fileName = joinFileNameForRename(draftBaseName, extension);
  const canSubmit = draftBaseName.trim().length > 0 && !!destinationPath && !isSubmitting;

  const handleConfirm = () => {
    if (!canSubmit || !destinationPath) return;
    onConfirm(fileName, destinationPath);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={cn(dialogSurfaceClassName, "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{labels.createMarkdownDialogTitle}</DialogTitle>
          <DialogDescription>{labels.createMarkdownDialogDescription}</DialogDescription>
        </DialogHeader>

        <RenameFilenameField
          focusKey={nextFocusSession}
          placeholder={labels.createMarkdownDialogNamePlaceholder}
          baseName={draftBaseName}
          extension={extension}
          disabled={isSubmitting}
          onBaseNameChange={setDraftBaseName}
          onEnter={handleConfirm}
        />

        {open ? (
          <DriveFolderPicker
            key={pickerRemountKey}
            labels={labels}
            files={files}
            groupPaths={groupPaths}
            moveIds={[]}
            initialBrowsePath={initialBrowsePath}
            initialSelectedPath={initialSelectedPath}
            operations={operations}
            currentUsername={currentUsername}
            groupRootNames={groupRootNames}
            rootLabels={rootLabels}
            rootIcon={rootIcon}
            onDestinationChange={handleDestinationChange}
          />
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {labels.createMarkdownDialogCancel}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={handleConfirm}>
            {labels.createMarkdownDialogConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
