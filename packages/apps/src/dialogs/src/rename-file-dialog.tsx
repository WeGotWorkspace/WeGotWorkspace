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

export type RenameFileDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** Placeholder and accessible name of the name field. */
  placeholder: string;
  cancelLabel: string;
  confirmLabel: string;
  baseName: string;
  onBaseNameChange: (value: string) => void;
  /** Shown read-only after the name (e.g. `.md`). */
  extension?: string;
  /** While the rename runs: the field and both actions wait. */
  busy?: boolean;
  /** The app's dialog surface class (`docs-dialog-surface`). */
  surfaceClassName: string;
  onClose: () => void;
  onSubmit: () => void;
};

/** Rename a file or folder (Docs and Drive): the name, its extension kept apart. */
export function RenameFileDialog({
  open,
  title,
  description,
  placeholder,
  cancelLabel,
  confirmLabel,
  baseName,
  onBaseNameChange,
  extension,
  busy = false,
  surfaceClassName,
  onClose,
  onSubmit,
}: RenameFileDialogProps) {
  const canSubmit = baseName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={surfaceClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <RenameFilenameField
          autoFocus
          placeholder={placeholder}
          baseName={baseName}
          extension={extension || undefined}
          disabled={busy}
          onBaseNameChange={onBaseNameChange}
          onEnter={onSubmit}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={busy || !canSubmit}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
