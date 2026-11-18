import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";

/** The words of the question; each app passes its own (a note, a task). */
export type CollabExternalWriteDialogLabels = {
  title: string;
  description: (name: string) => string;
  keepMine: string;
  useOutside: string;
};

export type CollabExternalWriteDialogProps = {
  open: boolean;
  /** The note or task title, for the description. */
  name: string;
  busy?: boolean;
  /** Set once the outside version replaced the local text in this question. */
  keepLocalDisabled?: boolean;
  labels: CollabExternalWriteDialogLabels;
  /** Extra class on the surface, such as an app's dialog surface. */
  className?: string;
  onKeepLocal: () => void;
  onUseOutside: () => void;
};

/**
 * The one question for a live text changed outside the app while this client
 * still has unsaved work. It stays until the person chooses, so a dismiss
 * cannot write either version.
 */
export function CollabExternalWriteDialog({
  open,
  name,
  busy = false,
  keepLocalDisabled = false,
  labels: L,
  className,
  onKeepLocal,
  onUseOutside,
}: CollabExternalWriteDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className={className}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{L.title}</DialogTitle>
          <DialogDescription>{L.description(name)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onUseOutside} disabled={busy}>
            {L.useOutside}
          </Button>
          <Button variant="primary" onClick={onKeepLocal} disabled={busy || keepLocalDisabled}>
            {L.keepMine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
