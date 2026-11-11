import { useCallback, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
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
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useAppToast } from "@/hooks/use-app-toast";
import { parentAndName } from "@/lib/files/api-path";
import { joinFileNameForRename, splitFileNameForRename } from "@/lib/files/filename-rename";

export type UseDocsFileRenameInput = {
  /** Open document's API path; renaming is off without one. */
  apiPath: string | null | undefined;
  operations: Pick<DriveAPIOperations, "renameItem"> | null | undefined;
  /** New API path after a successful rename (follow the document there). */
  onRenamed: (nextApiPath: string) => void;
};

/**
 * Rename the open document from its header (collab Docs). Same Drive call as the
 * Docs home row action; the caller follows the new path.
 */
export function useDocsFileRename({ apiPath, operations, onRenamed }: UseDocsFileRenameInput): {
  open: (() => void) | undefined;
  dialog: ReactNode;
} {
  const { show, showError } = useAppToast();
  const [isOpen, setIsOpen] = useState(false);
  const [baseName, setBaseName] = useState("");
  const [extension, setExtension] = useState("");
  const [pending, setPending] = useState(false);

  const currentName = apiPath ? parentAndName(apiPath).from : "";

  const open = useCallback(() => {
    const split = splitFileNameForRename(currentName);
    setBaseName(split.baseName);
    setExtension(split.hasExtension ? split.extension : "");
    setIsOpen(true);
  }, [currentName]);

  const close = useCallback(() => {
    if (pending) return;
    setIsOpen(false);
  }, [pending]);

  const submit = useCallback(async () => {
    const nextName = extension ? joinFileNameForRename(baseName, extension) : baseName.trim();
    if (!apiPath || !operations || !nextName || nextName === currentName) {
      setIsOpen(false);
      return;
    }
    const { destination } = parentAndName(apiPath);
    setPending(true);
    try {
      await operations.renameItem({ destination, from: apiPath, to: nextName });
      setIsOpen(false);
      show(`Renamed to “${nextName}”`, { icon: <Pencil className="size-4" /> });
      onRenamed(destination === "/" ? `/${nextName}` : `${destination}/${nextName}`);
    } catch {
      showError(docsLabels.renameError);
    } finally {
      setPending(false);
    }
  }, [apiPath, baseName, currentName, extension, onRenamed, operations, show, showError]);

  const canSubmit = baseName.trim().length > 0;

  const dialog = (
    <Dialog open={isOpen} onOpenChange={(next) => !next && close()}>
      <DialogContent className="docs-dialog-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{docsLabels.renameDialogTitle}</DialogTitle>
          <DialogDescription>{docsLabels.renameDialogDescription}</DialogDescription>
        </DialogHeader>
        <RenameFilenameField
          autoFocus
          placeholder={docsLabels.rename}
          baseName={baseName}
          extension={extension || undefined}
          disabled={pending}
          onBaseNameChange={setBaseName}
          onEnter={() => void submit()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            {docsLabels.cancel}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={pending || !canSubmit}>
            {docsLabels.renameAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { open: apiPath && operations ? open : undefined, dialog };
}
