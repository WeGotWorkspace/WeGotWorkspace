import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import "@/text-editor-core/docs-collab/docs-conflict-dialog.css";

export type DocsConflictDialogProps = {
  open: boolean;
  documentTitle: string;
  busy?: boolean;
  labels: DocsUILabels;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onOpenChange?: (open: boolean) => void;
};

/** Binary Keep mine / Use server resolver for collab save conflicts. */
export function DocsConflictDialog({
  open,
  documentTitle,
  busy = false,
  labels,
  onKeepLocal,
  onUseServer,
  onOpenChange,
}: DocsConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="docs-dialog-surface docs-conflict-dialog">
        <DialogHeader>
          <DialogTitle>{labels.conflictTitle}</DialogTitle>
          <DialogDescription>{labels.conflictDescription(documentTitle)}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="docs-conflict-dialog__actions">
          <Button variant="outline" onClick={onUseServer} disabled={busy}>
            {labels.conflictUseServer}
          </Button>
          <Button variant="primary" onClick={onKeepLocal} disabled={busy}>
            {labels.conflictKeepMine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
