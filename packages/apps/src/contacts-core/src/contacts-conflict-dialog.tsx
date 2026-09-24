import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Label } from "@/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/radio-group";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import {
  defaultContactConflictFieldChoices,
  type ContactConflictFieldChoices,
  type ContactConflictFieldRow,
} from "@/lib/offline/contacts-conflict-merge";
import "@/contacts-core/src/contacts-conflict-dialog.css";

export type ContactsConflictDialogProps = {
  open: boolean;
  /** Display name of the contact currently being resolved. */
  contactName: string;
  /** Conflicts still queued behind this one (shown as a hint). */
  remainingCount?: number;
  /** Disables the actions while a resolution is in flight. */
  busy?: boolean;
  labels: ContactsUILabels;
  /** Per-field rows; when non-empty, renders the field-level merge UI. */
  fieldRows?: ContactConflictFieldRow[];
  /** Controlled field choices (field merge mode). */
  fieldChoices?: ContactConflictFieldChoices;
  onFieldChoicesChange?: (choices: ContactConflictFieldChoices) => void;
  onConfirmMerge?: (choices: ContactConflictFieldChoices) => void;
  onKeepLocal?: () => void;
  onUseServer?: () => void;
  /** Called when the dialog is dismissed (Esc/overlay) without choosing. */
  onOpenChange?: (open: boolean) => void;
};

function FieldValue({ value }: { value: string }) {
  return (
    <span className="contacts-conflict-dialog__value">
      {value.split("\n").map((line, index) => (
        <span key={`${line}-${index}`} className="contacts-conflict-dialog__value-line">
          {line}
        </span>
      ))}
    </span>
  );
}

function ConflictFieldRowPicker({
  row,
  choice,
  busy,
  labels: L,
  onChoiceChange,
}: {
  row: ContactConflictFieldRow;
  choice: ContactConflictFieldChoices[keyof ContactConflictFieldChoices];
  busy: boolean;
  labels: ContactsUILabels;
  onChoiceChange: (choice: "local" | "server") => void;
}) {
  const groupId = useId();
  const localId = `${groupId}-local`;
  const serverId = `${groupId}-server`;

  return (
    <fieldset className="contacts-conflict-dialog__field">
      <legend className="contacts-conflict-dialog__field-label">{row.label}</legend>
      <RadioGroup
        className="contacts-conflict-dialog__field-options"
        value={choice}
        onValueChange={(value) => onChoiceChange(value as "local" | "server")}
        disabled={busy}
        aria-label={`${row.label} conflict resolution`}
      >
        <div className="contacts-conflict-dialog__option">
          <RadioGroupItem value="local" id={localId} />
          <Label htmlFor={localId} className="contacts-conflict-dialog__option-label">
            <span className="contacts-conflict-dialog__option-heading">{L.conflictFieldLocal}</span>
            <FieldValue value={row.localValue} />
          </Label>
        </div>
        <div className="contacts-conflict-dialog__option">
          <RadioGroupItem value="server" id={serverId} />
          <Label htmlFor={serverId} className="contacts-conflict-dialog__option-label">
            <span className="contacts-conflict-dialog__option-heading">
              {L.conflictFieldServer}
            </span>
            <FieldValue value={row.serverValue} />
          </Label>
        </div>
      </RadioGroup>
    </fieldset>
  );
}

/** Field-level or binary resolver for a single contact sync conflict. */
export function ContactsConflictDialog({
  open,
  contactName,
  remainingCount = 0,
  busy = false,
  labels: L,
  fieldRows,
  fieldChoices: controlledChoices,
  onFieldChoicesChange,
  onConfirmMerge,
  onKeepLocal,
  onUseServer,
  onOpenChange,
}: ContactsConflictDialogProps) {
  const fieldMergeMode = Boolean(fieldRows && fieldRows.length > 0);
  const [internalChoices, setInternalChoices] = useState<ContactConflictFieldChoices>(() =>
    defaultContactConflictFieldChoices(fieldRows ?? []),
  );

  useEffect(() => {
    if (!open || !fieldRows?.length) return;
    const next = defaultContactConflictFieldChoices(fieldRows);
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  }, [open, fieldRows, onFieldChoicesChange]);

  const choices = controlledChoices ?? internalChoices;

  const setChoice = (key: ContactConflictFieldRow["key"], value: "local" | "server") => {
    const next = { ...choices, [key]: value };
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="contacts-dialog-surface contacts-conflict-dialog">
        <DialogHeader>
          <DialogTitle>{L.conflictTitle}</DialogTitle>
          <DialogDescription>
            {fieldMergeMode
              ? L.conflictDescriptionFieldMerge(contactName)
              : L.conflictDescription(contactName)}
          </DialogDescription>
        </DialogHeader>
        {remainingCount > 0 ? (
          <p className="contacts-conflict-dialog__remaining">
            {L.conflictRemaining(remainingCount)}
          </p>
        ) : null}
        {fieldMergeMode ? (
          <div className="contacts-conflict-dialog__fields">
            {fieldRows?.map((row) => (
              <ConflictFieldRowPicker
                key={row.key}
                row={row}
                choice={choices[row.key] ?? "local"}
                busy={busy}
                labels={L}
                onChoiceChange={(value) => setChoice(row.key, value)}
              />
            ))}
          </div>
        ) : null}
        <DialogFooter className="contacts-conflict-dialog__actions">
          {fieldMergeMode ? (
            <>
              <Button variant="outline" onClick={onUseServer} disabled={busy}>
                {L.conflictUseServer}
              </Button>
              <Button variant="primary" onClick={() => onConfirmMerge?.(choices)} disabled={busy}>
                {L.conflictApplyMerge}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onUseServer} disabled={busy}>
                {L.conflictUseServer}
              </Button>
              <Button variant="primary" onClick={onKeepLocal} disabled={busy}>
                {L.conflictKeepMine}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
