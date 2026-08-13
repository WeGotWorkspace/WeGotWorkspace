import { useEffect, useRef, useState } from "react";
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

/**
 * Only-this vs This-and-future chooser.
 *
 * Hardened against the click→open race: opening from a Lit shadow-DOM click
 * (or React Strict Mode remount) can fire Radix `onOpenChange(false)` /
 * outside-interact immediately and cancel the Promise before the user acts —
 * which aborted `openEditEventKey` and left recurring clicks with no edit dialog.
 */
export function CalendarRecurrenceScopeDialog({
  dialog,
  labels,
}: CalendarRecurrenceScopeDialogProps) {
  const [choice, setChoice] = useState<RecurrenceEditScope>("thisInstance");
  const open = dialog !== null;
  const settledRef = useRef(false);
  /** Ignore dismiss signals until the opening pointer gesture has fully settled. */
  const ignoreDismissRef = useRef(false);

  useEffect(() => {
    if (!dialog) {
      settledRef.current = false;
      ignoreDismissRef.current = false;
      return;
    }
    settledRef.current = false;
    ignoreDismissRef.current = true;
    setChoice("thisInstance");
    const timer = window.setTimeout(() => {
      ignoreDismissRef.current = false;
    }, 100);
    return () => window.clearTimeout(timer);
  }, [dialog]);

  const title =
    dialog?.action === "delete"
      ? labels.recurrenceScopeDeleteTitle
      : labels.recurrenceScopeEditTitle;

  const close = (scope: RecurrenceEditScope | null) => {
    if (!dialog || settledRef.current) return;
    settledRef.current = true;
    dialog.resolve(scope);
  };

  const preventPrematureDismiss = (event: Event) => {
    if (ignoreDismissRef.current) {
      event.preventDefault();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (ignoreDismissRef.current) return;
          close(null);
        }
      }}
    >
      <DialogContent
        className="calendar-dialog-surface"
        aria-describedby={undefined}
        onPointerDownOutside={preventPrematureDismiss}
        onInteractOutside={preventPrematureDismiss}
        onFocusOutside={preventPrematureDismiss}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <fieldset className="calendar-recurrence-scope">
          <legend className="sr-only">{title}</legend>
          <label className="calendar-recurrence-scope__option">
            <input
              type="radio"
              name="calendar-recurrence-scope"
              value="thisInstance"
              checked={choice === "thisInstance"}
              onChange={() => setChoice("thisInstance")}
            />
            <span>{labels.recurrenceScopeThisInstance}</span>
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
