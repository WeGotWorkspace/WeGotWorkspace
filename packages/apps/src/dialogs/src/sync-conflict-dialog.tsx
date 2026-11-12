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
import { cn } from "@/lib/utils";
import "@/dialogs/src/sync-conflict-dialog.css";

export type SyncConflictChoice = "local" | "server";

export type SyncConflictFieldRow<K extends string> = {
  key: K;
  label: string;
  localValue: string;
  serverValue: string;
};

export type SyncConflictChoices<K extends string> = Record<K, SyncConflictChoice>;

export type SyncConflictDialogLabels = {
  conflictTitle: string;
  conflictDescription: (name: string) => string;
  conflictDescriptionFieldMerge: (name: string) => string;
  conflictRemaining: (count: number) => string;
  conflictKeepMine: string;
  conflictUseServer: string;
  conflictFieldLocal: string;
  conflictFieldServer: string;
  conflictApplyMerge: string;
};

export type SyncConflictDialogProps<K extends string> = {
  open: boolean;
  /** Name of the record being resolved (contact name, task title). */
  itemName: string;
  /** Conflicts still queued behind this one (shown as a hint). */
  remainingCount?: number;
  /** Disables the actions while a resolution is in flight. */
  busy?: boolean;
  labels: SyncConflictDialogLabels;
  /** The app's dialog surface (`contacts-dialog-surface`, …). */
  surfaceClassName?: string;
  /** Per-field rows; when non-empty, renders the field-level merge UI. */
  fieldRows?: SyncConflictFieldRow<K>[];
  /** Controlled field choices (field merge mode). */
  fieldChoices?: SyncConflictChoices<K>;
  onFieldChoicesChange?: (choices: SyncConflictChoices<K>) => void;
  onConfirmMerge?: (choices: SyncConflictChoices<K>) => void;
  onKeepLocal?: () => void;
  onUseServer?: () => void;
  /** Called when the dialog is dismissed (Esc/overlay) without choosing. */
  onOpenChange?: (open: boolean) => void;
};

/** Every differing field starts on the user's queued (local) edit. */
function localChoices<K extends string>(rows: SyncConflictFieldRow<K>[]): SyncConflictChoices<K> {
  const choices = {} as SyncConflictChoices<K>;
  for (const row of rows) choices[row.key] = "local";
  return choices;
}

function FieldValue({ value }: { value: string }) {
  return (
    <span className="sync-conflict-dialog__value">
      {value.split("\n").map((line, index) => (
        <span key={`${line}-${index}`} className="sync-conflict-dialog__value-line">
          {line}
        </span>
      ))}
    </span>
  );
}

function ConflictFieldPicker<K extends string>({
  row,
  choice,
  busy,
  labels: L,
  onChoiceChange,
}: {
  row: SyncConflictFieldRow<K>;
  choice: SyncConflictChoice;
  busy: boolean;
  labels: SyncConflictDialogLabels;
  onChoiceChange: (choice: SyncConflictChoice) => void;
}) {
  const groupId = useId();
  const localId = `${groupId}-local`;
  const serverId = `${groupId}-server`;

  return (
    <fieldset className="sync-conflict-dialog__field">
      <legend className="sync-conflict-dialog__field-label">{row.label}</legend>
      <RadioGroup
        className="sync-conflict-dialog__field-options"
        value={choice}
        onValueChange={(value) => onChoiceChange(value as SyncConflictChoice)}
        disabled={busy}
        aria-label={`${row.label} conflict resolution`}
      >
        <div className="sync-conflict-dialog__option">
          <RadioGroupItem value="local" id={localId} />
          <Label htmlFor={localId} className="sync-conflict-dialog__option-label">
            <span className="sync-conflict-dialog__option-heading">{L.conflictFieldLocal}</span>
            <FieldValue value={row.localValue} />
          </Label>
        </div>
        <div className="sync-conflict-dialog__option">
          <RadioGroupItem value="server" id={serverId} />
          <Label htmlFor={serverId} className="sync-conflict-dialog__option-label">
            <span className="sync-conflict-dialog__option-heading">{L.conflictFieldServer}</span>
            <FieldValue value={row.serverValue} />
          </Label>
        </div>
      </RadioGroup>
    </fieldset>
  );
}

/** Field-level or binary resolver for one offline sync conflict (Contacts, Tasks). */
export function SyncConflictDialog<K extends string>({
  open,
  itemName,
  remainingCount = 0,
  busy = false,
  labels: L,
  surfaceClassName,
  fieldRows,
  fieldChoices: controlledChoices,
  onFieldChoicesChange,
  onConfirmMerge,
  onKeepLocal,
  onUseServer,
  onOpenChange,
}: SyncConflictDialogProps<K>) {
  const fieldMergeMode = Boolean(fieldRows && fieldRows.length > 0);
  const [internalChoices, setInternalChoices] = useState<SyncConflictChoices<K>>(() =>
    localChoices(fieldRows ?? []),
  );

  useEffect(() => {
    if (!open || !fieldRows?.length) return;
    const next = localChoices(fieldRows);
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  }, [open, fieldRows, onFieldChoicesChange]);

  const choices = controlledChoices ?? internalChoices;

  const setChoice = (key: K, value: SyncConflictChoice) => {
    const next = { ...choices, [key]: value };
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(surfaceClassName, "sync-conflict-dialog")}>
        <DialogHeader>
          <DialogTitle>{L.conflictTitle}</DialogTitle>
          <DialogDescription>
            {fieldMergeMode
              ? L.conflictDescriptionFieldMerge(itemName)
              : L.conflictDescription(itemName)}
          </DialogDescription>
        </DialogHeader>
        {remainingCount > 0 ? (
          <p className="sync-conflict-dialog__remaining">{L.conflictRemaining(remainingCount)}</p>
        ) : null}
        {fieldMergeMode ? (
          <div className="sync-conflict-dialog__fields">
            {fieldRows?.map((row) => (
              <ConflictFieldPicker
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
        <DialogFooter>
          <Button variant="outline" onClick={onUseServer} disabled={busy}>
            {L.conflictUseServer}
          </Button>
          {fieldMergeMode ? (
            <Button variant="primary" onClick={() => onConfirmMerge?.(choices)} disabled={busy}>
              {L.conflictApplyMerge}
            </Button>
          ) : (
            <Button variant="primary" onClick={onKeepLocal} disabled={busy}>
              {L.conflictKeepMine}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
