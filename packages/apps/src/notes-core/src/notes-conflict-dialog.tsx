import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import "@/notes-core/src/notes-conflict-dialog.css";

export type NotesConflictDialogProps = {
  open: boolean;
  noteTitle: string;
  remainingCount?: number;
  busy?: boolean;
  labels: NotesUILabels;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onOpenChange?: (open: boolean) => void;
};

/** Binary "Keep mine / Use server" resolver for a single note sync conflict. */
export function NotesConflictDialog({
  open,
  noteTitle,
  remainingCount = 0,
  busy = false,
  labels: L,
  onKeepLocal,
  onUseServer,
  onOpenChange,
}: NotesConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="notes-dialog-surface notes-conflict-dialog">
        <DialogHeader>
          <DialogTitle>{L.conflictTitle}</DialogTitle>
          <DialogDescription>{L.conflictDescription(noteTitle)}</DialogDescription>
        </DialogHeader>
        {remainingCount > 0 ? (
          <p className="notes-conflict-dialog__remaining">{L.conflictRemaining(remainingCount)}</p>
        ) : null}
        <DialogFooter className="notes-conflict-dialog__actions">
          <Button variant="outline" onClick={onUseServer} disabled={busy}>
            {L.conflictUseServer}
          </Button>
          <Button variant="primary" onClick={onKeepLocal} disabled={busy}>
            {L.conflictKeepMine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
