import type { ReactElement } from "react";
import { CollectionMoveDialog } from "@/ui/collection-move-dialog";
import { cn } from "@/lib/utils";
import {
  NotebookSelect,
  notebookSelectionEquals,
  type NotebookSelectItem,
  type NotebookSelectValue,
} from "@/project-dialog/src/notebook-select";
import "@/project-dialog/src/change-notebook-dialog.css";

const DEFAULT_DESCRIPTION = "Choose or create a notebook for the selected notes.";

export type ChangeNotebookDialogLabels = {
  addNotebook: string;
  toolbarMoveToNotebook: string;
  selectionMoveToNotebook: string;
  changeNotebookConfirm: string;
  dialogCancel: string;
};

export type ChangeNotebookDialogProps = {
  open: boolean;
  notebooks: NotebookSelectItem[];
  value: NotebookSelectValue;
  /** Newly created notebook to land as the draft (still requires Change). */
  createdNotebook?: NotebookSelectItem | null;
  labels: ChangeNotebookDialogLabels;
  /** Caption of the picker row. Without it the picker stands alone. */
  fieldLabel?: string;
  description?: string;
  contentClassName?: string;
  onClose: () => void;
  onNotebookChange: (notebook: NotebookSelectItem) => void;
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

function toSelectItem(value: NotebookSelectValue): NotebookSelectItem {
  return { id: value.id ?? value.name, name: value.name, color: value.color };
}

/** Move notes (or a task list's tasks) to a notebook: the shared move dialog with the notebook picker. */
export function ChangeNotebookDialog({
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
}: ChangeNotebookDialogProps): ReactElement {
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
          <NotebookSelect
            id={id}
            notebooks={notebooks}
            value={draft}
            labels={labels}
            triggerVariant="ghost"
            onNotebookChange={setDraft}
            onCreateNotebook={onCreateNotebook}
          />
        ) : (
          <NotebookSelect
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
