import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  groupSlugFromOwnerScopeValue,
  OwnerScopeField,
  ownerScopeValueFromDirectory,
  PERSONAL_SCOPE_VALUE,
} from "@/ui/owner-scope-field";
import { TaskProjectColorPicker } from "@/tasks-core/src/task-project-color-picker";
import { DEFAULT_TASK_LIST_COLOR, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import type { TaskProjectGroupOption } from "@/tasks-core/src/tasks-types";
import "./task-project-dialog.css";

export type TaskProjectDialogState =
  | null
  | { mode: "create" }
  | {
      mode: "edit";
      listId: string;
      name: string;
      color: string | null;
      scope: "personal" | "group";
      groupSlug: string | null;
    };

export type TaskProjectDialogConfirmInput = {
  name: string;
  color: string | null;
  groupSlug?: string | null;
};

type TaskProjectDialogLabels = {
  createTitle: string;
  editTitle: string;
  nameLabel: string;
  colorLabel: string;
  scopeLabel: string;
  scopePersonal: (ownerLabel: string) => string;
  scopeGroup: (name: string) => string;
  scopeReadOnlyLabel: string;
  createButton: string;
  saveButton: string;
  cancel: string;
};

type TaskProjectDialogProps = {
  dialog: TaskProjectDialogState;
  groups: TaskProjectGroupOption[];
  personalOwnerLabel: string;
  onClose: () => void;
  onConfirm: (input: TaskProjectDialogConfirmInput) => void;
  labels: TaskProjectDialogLabels;
  contentClassName?: string;
};

function editDialogDisplayColor(listId: string, color: string | null): string {
  return taskListDotColor({ id: listId, color });
}

export function TaskProjectDialog({
  dialog,
  groups,
  personalOwnerLabel,
  onClose,
  onConfirm,
  labels,
  contentClassName,
}: TaskProjectDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TASK_LIST_COLOR);
  const [scopeValue, setScopeValue] = useState(PERSONAL_SCOPE_VALUE);
  const open = dialog !== null;
  const isCreate = dialog?.mode === "create";

  useEffect(() => {
    if (!dialog) return;
    if (dialog.mode === "create") {
      setName("");
      setColor(DEFAULT_TASK_LIST_COLOR);
      setScopeValue(PERSONAL_SCOPE_VALUE);
      return;
    }
    setName(dialog.name);
    setColor(editDialogDisplayColor(dialog.listId, dialog.color));
    setScopeValue(ownerScopeValueFromDirectory(dialog.scope, dialog.groupSlug));
  }, [dialog]);

  const trimmedName = name.trim();
  const selectedColor = color.trim() || DEFAULT_TASK_LIST_COLOR;
  const unchangedEdit =
    dialog?.mode === "edit" &&
    trimmedName === dialog.name.trim() &&
    selectedColor.toLowerCase() ===
      editDialogDisplayColor(dialog.listId, dialog.color).toLowerCase();
  const canSubmit = Boolean(trimmedName) && (isCreate || !unchangedEdit);
  const ownerLabels = {
    label: labels.scopeLabel,
    personal: labels.scopePersonal,
    group: labels.scopeGroup,
    readOnlyLabel: labels.scopeReadOnlyLabel,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{isCreate ? labels.createTitle : labels.editTitle}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onConfirm({
              name: trimmedName,
              color: selectedColor,
              ...(isCreate ? { groupSlug: groupSlugFromOwnerScopeValue(scopeValue) } : {}),
            });
          }}
        >
          <FieldLabelRow label={labels.nameLabel} htmlFor="task-project-name">
            <div className="task-project-dialog__name-color-row">
              <Input
                id="task-project-name"
                className="task-project-dialog__name-input"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <TaskProjectColorPicker
                value={selectedColor}
                onChange={setColor}
                colorLabel={labels.colorLabel}
                previewListId={dialog?.mode === "edit" ? dialog.listId : trimmedName || "preview"}
              />
            </div>
          </FieldLabelRow>

          <OwnerScopeField
            id="task-project-scope"
            value={scopeValue}
            onValueChange={setScopeValue}
            groups={groups}
            personalOwnerLabel={personalOwnerLabel}
            labels={ownerLabels}
            disabled={!isCreate}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isCreate ? labels.createButton : labels.saveButton}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
