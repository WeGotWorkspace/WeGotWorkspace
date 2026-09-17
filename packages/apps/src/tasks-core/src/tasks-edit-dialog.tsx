import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  emptyTaskForm,
  taskToFormValue,
  TasksTaskFormFields,
  type TasksTaskFormValue,
} from "@/tasks-core/src/tasks-task-form";

export type TaskEditDialogState = null | { taskId: string };

type TasksEditDialogProps = {
  dialog: TaskEditDialogState;
  task: Task | null;
  taskLists: TaskList[];
  labels: TasksUILabels;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (value: TasksTaskFormValue) => void;
  onDelete?: () => void;
};

export function TasksEditDialog({
  dialog,
  task,
  taskLists,
  labels,
  readOnly = false,
  onClose,
  onSave,
  onDelete,
}: TasksEditDialogProps) {
  const [form, setForm] = useState(() => emptyTaskForm(task?.taskListId ?? "default"));

  useEffect(() => {
    if (!task) return;
    setForm(taskToFormValue(task, task.taskListId));
  }, [task]);

  const open = dialog !== null && task !== null;
  const trimmedTitle = form.title.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="tasks-dialog-surface tasks-edit-dialog__content">
        <DialogHeader>
          <DialogTitle>{labels.editTaskTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="tasks-edit-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmedTitle || readOnly) return;
            onSave({ ...form, title: trimmedTitle });
          }}
        >
          <div className="tasks-edit-dialog__fields">
            <TasksTaskFormFields
              L={labels}
              value={form}
              onChange={setForm}
              taskLists={taskLists}
              mode="edit"
              showDescription
              disabled={readOnly}
            />
          </div>
          <DialogFooter className="tasks-edit-dialog__footer">
            {onDelete && !readOnly ? (
              <IconButton
                type="button"
                variant="outline"
                severity="danger"
                size="md"
                className="tasks-edit-dialog__delete"
                icon={<Trash2 className="size-3.5" aria-hidden />}
                label={labels.delete}
                onClick={onDelete}
              />
            ) : null}
            <div className="tasks-edit-dialog__footer-end">
              <Button type="button" variant="outline" onClick={onClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!trimmedTitle || readOnly}>
                {labels.saveTaskButton}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
