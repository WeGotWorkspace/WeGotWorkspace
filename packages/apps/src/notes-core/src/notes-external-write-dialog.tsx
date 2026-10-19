import { Button } from "@/button/src/button";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import "@/notes-core/src/notes-conflict-dialog.css";

export type NotesExternalWriteDialogProps = {
  open: boolean;
  noteTitle: string;
  busy?: boolean;
  /** Set once the outside version replaced the local note in this question. */
  keepLocalDisabled?: boolean;
  labels: NotesUILabels;
  onKeepLocal: () => void;
  onUseOutside: () => void;
};

/**
 * The one prompt for a note changed outside the app while this client still
 * has unsaved work. It stays until the person chooses, so a dismiss cannot
 * write either version.
 */
export function NotesExternalWriteDialog({
  open,
  noteTitle,
  busy = false,
  keepLocalDisabled = false,
  labels: L,
  onKeepLocal,
  onUseOutside,
}: NotesExternalWriteDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="notes-dialog-surface notes-conflict-dialog"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{L.externalWriteTitle}</DialogTitle>
          <DialogDescription>{L.externalWriteDescription(noteTitle)}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="notes-conflict-dialog__actions">
          <Button variant="outline" onClick={onUseOutside} disabled={busy}>
            {L.externalWriteUseOutside}
          </Button>
          <Button variant="primary" onClick={onKeepLocal} disabled={busy || keepLocalDisabled}>
            {L.externalWriteKeepMine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
