import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import { TASK_LIST_DOT_COLORS } from "@/lib/models/task-lists";
import type { ProjectTeam } from "@/lib/api/wgw/projects";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { NO_AUTOFILL } from "@/ui/no-autofill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";

export type CreateProjectInput = { teamSlug: string; name: string; color: string };

export type CreateProjectDialogProps = {
  open: boolean;
  /** Only the Teams the user is team admin of. */
  teams: readonly ProjectTeam[];
  onOpenChange: (open: boolean) => void;
  /** Resolves true when created; the dialog then closes. */
  onCreate: (input: CreateProjectInput) => Promise<boolean>;
};

const DEFAULT_COLOR = TASK_LIST_DOT_COLORS[0] ?? "#3b82f6";

/** Name and color on one row, the Team below it, Create and Cancel. */
export function CreateProjectDialog({
  open,
  teams,
  onOpenChange,
  onCreate,
}: CreateProjectDialogProps) {
  const nameId = useId();
  const teamId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [teamSlug, setTeamSlug] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setColor(DEFAULT_COLOR);
    setTeamSlug(teams[0]?.slug ?? "");
    setBusy(false);
    // Reset once per opening; a Team list refresh while open keeps the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = name.trim();
  const canCreate = trimmed !== "" && teamSlug !== "" && !busy;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.createTitle}</DialogTitle>
          <DialogDescription>{labels.createDescription}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate) return;
            setBusy(true);
            const created = await onCreate({ teamSlug, name: trimmed, color });
            setBusy(false);
            if (created) onOpenChange(false);
          }}
        >
          <FieldLabelRow layout="inline" fill label={labels.nameLabel} htmlFor={nameId}>
            <NameColorRow>
              <Input
                id={nameId}
                {...NO_AUTOFILL}
                className={NAME_COLOR_ROW_INPUT_CLASS}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <SwatchColorPicker
                value={color}
                onChange={setColor}
                colorLabel={labels.colorLabel}
                swatches={TASK_LIST_DOT_COLORS}
              >
                <ColorSwatchTrigger
                  color={color}
                  label={labels.colorLabel}
                  aria-haspopup="dialog"
                />
              </SwatchColorPicker>
            </NameColorRow>
          </FieldLabelRow>
          <FieldLabelRow layout="inline" fill label={labels.teamLabel} htmlFor={teamId}>
            <Select value={teamSlug} onValueChange={setTeamSlug} disabled={teams.length < 2}>
              <SelectTrigger id={teamId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.slug} value={team.slug}>
                    {team.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
