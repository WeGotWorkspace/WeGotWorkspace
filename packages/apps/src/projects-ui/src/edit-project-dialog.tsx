import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import { TASK_LIST_DOT_COLORS } from "@/lib/models/task-lists";
import type { WorkspaceProject } from "@/lib/projects/projects-store";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { ProjectNameColorField } from "@/projects-ui/src/project-name-color-field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";

export type EditProjectInput = { name: string; color: string };

export type EditProjectDialogProps = {
  /** The Project being edited; the dialog is closed while this is null. */
  project: WorkspaceProject | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when saved; the dialog then closes. */
  onSave: (project: WorkspaceProject, input: EditProjectInput) => Promise<boolean>;
};

const DEFAULT_COLOR = TASK_LIST_DOT_COLORS[0] ?? "#3b82f6";

/** Name and color of one Project: Save and Cancel, nothing is stored before Save. */
export function EditProjectDialog({ project, onOpenChange, onSave }: EditProjectDialogProps) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setColor(project.color ?? DEFAULT_COLOR);
    setBusy(false);
    // Reset once per opening, not on every refresh of the same Project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const trimmed = name.trim();
  const changed =
    project !== null && (trimmed !== project.name || color !== (project.color ?? DEFAULT_COLOR));
  const canSave = trimmed !== "" && changed && !busy;

  return (
    <Dialog open={project !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.editTitle}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!project || !canSave) return;
            setBusy(true);
            const saved = await onSave(project, { name: trimmed, color });
            setBusy(false);
            if (saved) onOpenChange(false);
          }}
        >
          <ProjectNameColorField
            id={nameId}
            name={name}
            color={color}
            onNameChange={setName}
            onColorChange={setColor}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
