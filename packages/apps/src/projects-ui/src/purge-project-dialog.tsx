import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NO_AUTOFILL } from "@/ui/no-autofill";

export type PurgeProjectDialogProps = {
  /** The archived Project to delete; null keeps the dialog closed. */
  projectName: string | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when deleted; the dialog then closes. */
  onPurge: () => Promise<boolean>;
};

/** Permanent delete: the confirm button stays off until the Project's name is typed. */
export function PurgeProjectDialog({
  projectName,
  onOpenChange,
  onPurge,
}: PurgeProjectDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTyped("");
    setBusy(false);
  }, [projectName]);

  if (projectName === null) return null;
  const matches = typed.trim() === projectName;

  return (
    <AlertDialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.purgeTitle(projectName)}</AlertDialogTitle>
          <AlertDialogDescription>{labels.purgeDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!matches || busy) return;
            setBusy(true);
            const purged = await onPurge();
            setBusy(false);
            if (purged) onOpenChange(false);
          }}
        >
          <FieldLabelRow label={labels.purgeConfirmLabel(projectName)} htmlFor={inputId}>
            <Input
              id={inputId}
              {...NO_AUTOFILL}
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FieldLabelRow>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{labels.cancel}</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!matches || busy}>
              {labels.purge}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
