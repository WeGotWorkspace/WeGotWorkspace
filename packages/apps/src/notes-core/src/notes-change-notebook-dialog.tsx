import type { ReactElement } from "react";
import { CollectionMoveDialog } from "@/ui/collection-move-dialog";
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

/** Move notes (or a task list's tasks) to a notebook: the shared move dialog with the notebook picker. */
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
  requireChange,
  confirmDisabled,
  destructiveAction,
}: NotesChangeNotebookDialogProps): ReactElement {
  return (
    <CollectionMoveDialog
      open={open}
      value={toSelectItem(value)}
      createdTarget={createdNotebook}
      title={title ?? labels.selectionMoveToNotebook}
      description={description}
      fieldLabel={fieldLabel}
      confirmLabel={confirmLabel || labels.changeNotebookConfirm || "Change"}
      cancelLabel={labels.dialogCancel}
      contentClassName={cn("notes-dialog-surface notes-change-notebook-dialog", contentClassName)}
      isSame={(draft) => notebookSelectionEquals(draft, value)}
      requireChange={requireChange}
      confirmDisabled={confirmDisabled}
      destructiveAction={destructiveAction}
      renderPicker={({ id, draft, setDraft }) =>
        fieldLabel ? (
          <NotesNotebookSelect
            id={id}
            notebooks={notebooks}
            value={draft}
            labels={labels}
            triggerVariant="ghost"
            onNotebookChange={setDraft}
            onCreateNotebook={onCreateNotebook}
          />
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
        )
      }
      onClose={onClose}
      onConfirm={onNotebookChange}
    />
  );
}
