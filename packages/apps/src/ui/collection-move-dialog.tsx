import { useId, useState, type ReactElement, type ReactNode } from "react";
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

export type CollectionMoveTarget = { id: string; name: string };

export type CollectionMoveDialogProps<T extends CollectionMoveTarget> = {
  open: boolean;
  /** Where the items are now; the picker starts here. */
  value: T;
  /** A collection just created from the picker: it lands as the draft (still needs confirm). */
  createdTarget?: T | null;
  title: string;
  description: string;
  /** Caption of the picker row. Without it the picker stands alone. */
  fieldLabel?: string;
  confirmLabel: string | ((destinationName: string) => string);
  cancelLabel: string;
  contentClassName?: string;
  /** The same destination as `value` (confirm then needs a change). */
  isSame: (draft: T, value: T) => boolean;
  /** When false, confirm is enabled even if the draft equals `value`. Default true. */
  requireChange?: boolean;
  /** Keeps confirm from firing again while the caller is still finishing. */
  confirmDisabled?: boolean;
  /** Destructive side action at the start of the footer — e.g. "Delete the notes too". */
  destructiveAction?: { label: string; onAction: () => void };
  /** The app's collection picker (notebook, calendar, list) for the draft. */
  renderPicker: (picker: { id: string; draft: T; setDraft: (next: T) => void }) => ReactNode;
  onClose: () => void;
  onConfirm: (target: T) => void;
};

/**
 * Move to another collection (notebook, calendar, task list): the app's picker on one
 * row, then Cancel and the move. The draft starts over on each open.
 */
export function CollectionMoveDialog<T extends CollectionMoveTarget>({
  open,
  value,
  createdTarget,
  title,
  description,
  fieldLabel,
  confirmLabel,
  cancelLabel,
  contentClassName,
  isSame,
  requireChange = true,
  confirmDisabled = false,
  destructiveAction,
  renderPicker,
  onClose,
  onConfirm,
}: CollectionMoveDialogProps<T>): ReactElement {
  const pickerId = useId();
  // The draft starts over on each open and when a new collection was just created.
  const session = open ? (createdTarget?.id ?? "open") : null;
  const [draftSession, setDraftSession] = useState(session);
  const [draft, setDraft] = useState<T>(createdTarget ?? value);
  if (session !== draftSession) {
    setDraftSession(session);
    if (session) setDraft(createdTarget ?? value);
  }

  const dirty = requireChange === false || !isSame(draft, value);
  const hasDestination = draft.id.trim() !== "" && draft.name.trim() !== "";
  const canConfirm = dirty && hasDestination && !confirmDisabled;
  const picker = renderPicker({ id: pickerId, draft, setDraft });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {fieldLabel ? (
          <FieldLabelRow layout="inline" label={fieldLabel} htmlFor={pickerId}>
            {picker}
          </FieldLabelRow>
        ) : (
          picker
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
          <Button type="button" variant="outline" label={cancelLabel} onClick={onClose} />
          <Button
            type="button"
            variant="primary"
            label={typeof confirmLabel === "function" ? confirmLabel(draft.name) : confirmLabel}
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) return;
              onConfirm(draft);
              onClose();
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
