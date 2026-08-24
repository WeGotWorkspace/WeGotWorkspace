import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import "@/calendar-core/src/calendar-conflict-dialog.css";

export type CalendarConflictDialogProps = {
  open: boolean;
  eventTitle: string;
  remainingCount?: number;
  busy?: boolean;
  labels: CalendarUILabels;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onOpenChange?: (open: boolean) => void;
};

/** Binary "Keep mine / Use server" resolver for a single calendar event sync conflict. */
export function CalendarConflictDialog({
  open,
  eventTitle,
  remainingCount = 0,
  busy = false,
  labels: L,
  onKeepLocal,
  onUseServer,
  onOpenChange,
}: CalendarConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="calendar-dialog-surface calendar-conflict-dialog">
        <DialogHeader>
          <DialogTitle>{L.conflictTitle}</DialogTitle>
          <DialogDescription>{L.conflictDescription(eventTitle)}</DialogDescription>
        </DialogHeader>
        {remainingCount > 0 ? (
          <p className="calendar-conflict-dialog__remaining">
            {L.conflictRemaining(remainingCount)}
          </p>
        ) : null}
        <DialogFooter className="calendar-conflict-dialog__actions">
          <Button variant="subtle" onClick={onUseServer} disabled={busy}>
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
