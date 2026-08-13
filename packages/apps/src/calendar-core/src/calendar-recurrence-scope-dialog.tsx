import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";

export type CalendarRecurrenceScopeDialogState = null | {
  action: "edit" | "delete" | "update";
  resolve: (scope: RecurrenceEditScope | null) => void;
};

type CalendarRecurrenceScopeDialogProps = {
  dialog: CalendarRecurrenceScopeDialogState;
  labels: CalendarUILabels;
};

export function CalendarRecurrenceScopeDialog({
  dialog,
  labels,
}: CalendarRecurrenceScopeDialogProps) {
  const [choice, setChoice] = useState<RecurrenceEditScope>("all");
  const open = dialog !== null;

  useEffect(() => {
    if (dialog) setChoice("all");
  }, [dialog]);

  const title =
    dialog?.action === "delete"
      ? labels.recurrenceScopeDeleteTitle
      : labels.recurrenceScopeEditTitle;

  const close = (scope: RecurrenceEditScope | null) => {
    dialog?.resolve(scope);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(null);
      }}
    >
      <DialogContent className="calendar-dialog-surface" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <fieldset className="calendar-recurrence-scope">
          <legend className="sr-only">{title}</legend>
          <label className="calendar-recurrence-scope__option">
            <input
              type="radio"
              name="calendar-recurrence-scope"
              value="all"
              checked={choice === "all"}
              onChange={() => setChoice("all")}
            />
            <span>{labels.recurrenceScopeAll}</span>
          </label>
          <label className="calendar-recurrence-scope__option">
            <input
              type="radio"
              name="calendar-recurrence-scope"
              value="thisAndFuture"
              checked={choice === "thisAndFuture"}
              onChange={() => setChoice("thisAndFuture")}
            />
            <span>{labels.recurrenceScopeThisAndFuture}</span>
          </label>
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(null)}>
            {labels.cancel}
          </Button>
          <Button type="button" onClick={() => close(choice)}>
            {labels.recurrenceScopeContinue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
