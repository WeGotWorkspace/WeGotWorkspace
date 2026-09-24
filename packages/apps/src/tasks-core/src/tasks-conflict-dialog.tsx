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
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  defaultTaskConflictFieldChoices,
  type TaskConflictFieldChoices,
  type TaskConflictFieldRow,
} from "@/lib/offline/tasks-conflict-merge";
import "./tasks-conflict-dialog.css";

export type TasksConflictDialogProps = {
  open: boolean;
  taskTitle: string;
  remainingCount?: number;
  busy?: boolean;
  labels: TasksUILabels;
  fieldRows?: TaskConflictFieldRow[];
  fieldChoices?: TaskConflictFieldChoices;
  onFieldChoicesChange?: (choices: TaskConflictFieldChoices) => void;
  onConfirmMerge?: (choices: TaskConflictFieldChoices) => void;
  onKeepLocal?: () => void;
  onUseServer?: () => void;
  onOpenChange?: (open: boolean) => void;
};

function FieldValue({ value }: { value: string }) {
  return (
    <span className="tasks-conflict-dialog__value">
      {value.split("\n").map((line, index) => (
        <span key={`${line}-${index}`} className="tasks-conflict-dialog__value-line">
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
  row: TaskConflictFieldRow;
  choice: TaskConflictFieldChoices[keyof TaskConflictFieldChoices];
  busy: boolean;
  labels: TasksUILabels;
  onChoiceChange: (choice: "local" | "server") => void;
}) {
  const groupId = useId();
  const localId = `${groupId}-local`;
  const serverId = `${groupId}-server`;

  return (
    <fieldset className="tasks-conflict-dialog__field">
      <legend className="tasks-conflict-dialog__field-label">{row.label}</legend>
      <RadioGroup
        className="tasks-conflict-dialog__field-options"
        value={choice}
        onValueChange={(value) => onChoiceChange(value as "local" | "server")}
        disabled={busy}
        aria-label={`${row.label} conflict resolution`}
      >
        <div className="tasks-conflict-dialog__option">
          <RadioGroupItem value="local" id={localId} />
          <Label htmlFor={localId} className="tasks-conflict-dialog__option-label">
            <span className="tasks-conflict-dialog__option-heading">{L.conflictFieldLocal}</span>
            <FieldValue value={row.localValue} />
          </Label>
        </div>
        <div className="tasks-conflict-dialog__option">
          <RadioGroupItem value="server" id={serverId} />
          <Label htmlFor={serverId} className="tasks-conflict-dialog__option-label">
            <span className="tasks-conflict-dialog__option-heading">{L.conflictFieldServer}</span>
            <FieldValue value={row.serverValue} />
          </Label>
        </div>
      </RadioGroup>
    </fieldset>
  );
}

export function TasksConflictDialog({
  open,
  taskTitle,
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
}: TasksConflictDialogProps) {
  const fieldMergeMode = Boolean(fieldRows && fieldRows.length > 0);
  const [internalChoices, setInternalChoices] = useState<TaskConflictFieldChoices>(() =>
    defaultTaskConflictFieldChoices(fieldRows ?? []),
  );

  useEffect(() => {
    if (!open || !fieldRows?.length) return;
    const next = defaultTaskConflictFieldChoices(fieldRows);
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  }, [open, fieldRows, onFieldChoicesChange]);

  const choices = controlledChoices ?? internalChoices;

  const setChoice = (key: TaskConflictFieldRow["key"], value: "local" | "server") => {
    const next = { ...choices, [key]: value };
    setInternalChoices(next);
    onFieldChoicesChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tasks-dialog-surface tasks-conflict-dialog">
        <DialogHeader>
          <DialogTitle>{L.conflictTitle}</DialogTitle>
          <DialogDescription>
            {fieldMergeMode
              ? L.conflictDescriptionFieldMerge(taskTitle)
              : L.conflictDescription(taskTitle)}
          </DialogDescription>
        </DialogHeader>
        {remainingCount > 0 ? (
          <p className="tasks-conflict-dialog__remaining">{L.conflictRemaining(remainingCount)}</p>
        ) : null}
        {fieldMergeMode ? (
          <div className="tasks-conflict-dialog__fields">
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
        <DialogFooter className="tasks-conflict-dialog__actions">
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
