import { useState, type ReactElement } from "react";
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
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import {
  NotesNotebookSelect,
  notebookSelectionEquals,
  type NotesNotebookSelectItem,
  type NotesNotebookSelectValue,
} from "@/notes-core/src/notes-notebook-select";
import "@/notes-core/src/notes-change-notebook-dialog.css";

const DEFAULT_DESCRIPTION = "Choose or create a notebook for the selected notes.";

export type NotesChangeNotebookDialogProps = {
  open: boolean;
  notebooks: NotesNotebookSelectItem[];
  value: NotesNotebookSelectValue;
  /** Newly created notebook to land as the draft (still requires Change). */
  createdNotebook?: NotesNotebookSelectItem | null;
  labels: Pick<
    NotesUILabels,
    | "addNotebook"
    | "toolbarMoveToNotebook"
    | "selectionMoveToNotebook"
    | "changeNotebookConfirm"
    | "dialogCancel"
  >;
  description?: string;
  contentClassName?: string;
  onClose: () => void;
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
};

function toSelectItem(value: NotesNotebookSelectValue): NotesNotebookSelectItem {
  return { id: value.id ?? value.name, name: value.name, color: value.color };
}

function NotesChangeNotebookDialogForm({
  notebooks,
  value,
  createdNotebook,
  labels,
  onClose,
  onNotebookChange,
  onCreateNotebook,
}: Omit<NotesChangeNotebookDialogProps, "open" | "description" | "contentClassName">): ReactElement {
  const [draft, setDraft] = useState<NotesNotebookSelectItem>(
    createdNotebook ?? toSelectItem(value),
  );
  const dirty = !notebookSelectionEquals(draft, value);
  const confirmLabel = labels.changeNotebookConfirm || "Change";

  return (
    <>
      <div className="notes-change-notebook-dialog__picker">
        <NotesNotebookSelect
          notebooks={notebooks}
          value={draft}
          labels={labels}
          onNotebookChange={setDraft}
          onCreateNotebook={onCreateNotebook}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" label={labels.dialogCancel} onClick={onClose} />
        <Button
          type="button"
          variant="primary"
          label={confirmLabel}
          disabled={!dirty}
          onClick={() => {
            if (!dirty) return;
            onNotebookChange(draft);
            onClose();
          }}
        />
      </DialogFooter>
    </>
  );
}

export function NotesChangeNotebookDialog({
  open,
  notebooks,
  value,
  createdNotebook,
  labels,
  description = DEFAULT_DESCRIPTION,
  contentClassName,
  onClose,
  onNotebookChange,
  onCreateNotebook,
}: NotesChangeNotebookDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn("notes-dialog-surface notes-change-notebook-dialog", contentClassName)}
      >
        <DialogHeader>
          <DialogTitle>{labels.selectionMoveToNotebook}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <NotesChangeNotebookDialogForm
            key={createdNotebook?.id ?? "open"}
            notebooks={notebooks}
            value={value}
            createdNotebook={createdNotebook}
            labels={labels}
            onClose={onClose}
            onNotebookChange={onNotebookChange}
            onCreateNotebook={onCreateNotebook}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
