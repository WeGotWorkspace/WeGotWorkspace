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
import { FieldLabelRow } from "@/ui/field-label-row";
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
const PICKER_ID = "notes-change-notebook-picker";

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
  /** Caption of the picker row. Without it the picker stands alone. */
  fieldLabel?: string;
  description?: string;
  contentClassName?: string;
  onClose: () => void;
  onNotebookChange: (notebook: NotesNotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  /** Overrides the default title (`labels.selectionMoveToNotebook`). */
  title?: string;
  /** Overrides the default confirm label (`labels.changeNotebookConfirm`). */
  confirmLabel?: string | ((destinationName: string) => string);
  /** When false, confirm is enabled even if the draft equals `value`. Default true. */
  requireChange?: boolean;
  /** Keeps confirm from firing again while the caller is still finishing. */
  confirmDisabled?: boolean;
  /** Destructive side action at the start of the footer — e.g. "Delete the notes too". */
  destructiveAction?: { label: string; onAction: () => void };
};

function toSelectItem(value: NotesNotebookSelectValue): NotesNotebookSelectItem {
  return { id: value.id ?? value.name, name: value.name, color: value.color };
}

export function NotesChangeNotebookDialog({
  open,
  notebooks,
  value,
  createdNotebook,
  labels,
  fieldLabel,
  description = DEFAULT_DESCRIPTION,
  contentClassName,
  onClose,
  onNotebookChange,
  onCreateNotebook,
  title,
  confirmLabel,
  requireChange = true,
  confirmDisabled = false,
  destructiveAction,
}: NotesChangeNotebookDialogProps): ReactElement {
  // The draft starts over on each open and when a new notebook was just created.
  const session = open ? (createdNotebook?.id ?? "open") : null;
  const [draftSession, setDraftSession] = useState(session);
  const [draft, setDraft] = useState<NotesNotebookSelectItem>(
    createdNotebook ?? toSelectItem(value),
  );
  if (session !== draftSession) {
    setDraftSession(session);
    if (session) setDraft(createdNotebook ?? toSelectItem(value));
  }

  const dirty = requireChange === false || !notebookSelectionEquals(draft, value);
  const hasDestination = draft.id.trim() !== "" && draft.name.trim() !== "";
  const canConfirm = dirty && hasDestination;
  const confirmText =
    typeof confirmLabel === "function"
      ? confirmLabel(draft.name)
      : confirmLabel || labels.changeNotebookConfirm || "Change";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn("notes-dialog-surface notes-change-notebook-dialog", contentClassName)}
      >
        <DialogHeader>
          <DialogTitle>{title ?? labels.selectionMoveToNotebook}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {fieldLabel ? (
          <FieldLabelRow layout="inline" label={fieldLabel} htmlFor={PICKER_ID}>
            <NotesNotebookSelect
              id={PICKER_ID}
              notebooks={notebooks}
              value={draft}
              labels={labels}
              triggerVariant="ghost"
              onNotebookChange={setDraft}
              onCreateNotebook={onCreateNotebook}
            />
          </FieldLabelRow>
        ) : (
          <NotesNotebookSelect
            className="notes-change-notebook-dialog__picker"
            notebooks={notebooks}
            value={draft}
            labels={labels}
            size="sm"
            onNotebookChange={setDraft}
            onCreateNotebook={onCreateNotebook}
          />
        )}
        <DialogFooter
          start={
            destructiveAction ? (
              <Button
                type="button"
                variant="outline"
                severity="danger"
                label={destructiveAction.label}
                onClick={destructiveAction.onAction}
              />
            ) : undefined
          }
        >
          <Button type="button" variant="outline" label={labels.dialogCancel} onClick={onClose} />
          <Button
            type="button"
            variant="primary"
            label={confirmText}
            disabled={!canConfirm || confirmDisabled}
            onClick={() => {
              if (!canConfirm || confirmDisabled) return;
              onNotebookChange(draft);
              onClose();
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
