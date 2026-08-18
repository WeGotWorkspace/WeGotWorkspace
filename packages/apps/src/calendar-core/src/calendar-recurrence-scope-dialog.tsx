import { useEffect, useRef } from "react";
import { Button } from "@/button/src/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { RecurrenceScopeChoice } from "@/calendar-core/src/calendar-recurrence-scope";

export type CalendarRecurrenceScopeDialogState = null | {
  action: "edit" | "delete" | "update";
  /** Optional short context (e.g. move target time). */
  description?: string;
  resolve: (scope: RecurrenceScopeChoice | null) => void;
};

type CalendarRecurrenceScopeDialogProps = {
  dialog: CalendarRecurrenceScopeDialogState;
  labels: CalendarUILabels;
};

/**
 * Scope chooser for recurring occurrences — stacked action buttons.
 *
 * Edit / move / resize: Only this event | All future events.
 * Delete: those two plus All events (destroy the master series).
 *
 * Hardened against the click→open race: opening from a Lit shadow-DOM click
 * (or React Strict Mode remount) can fire Radix `onOpenChange(false)` /
 * outside-interact immediately and cancel the Promise before the user acts.
 */
export function CalendarRecurrenceScopeDialog({
  dialog,
  labels,
}: CalendarRecurrenceScopeDialogProps) {
  const open = dialog !== null;
  const settledRef = useRef(false);
  /** Ignore dismiss signals until the opening pointer gesture has fully settled. */
  const ignoreDismissRef = useRef(false);
  const isDelete = dialog?.action === "delete";

  useEffect(() => {
    if (!dialog) {
      settledRef.current = false;
      ignoreDismissRef.current = false;
      return;
    }
    settledRef.current = false;
    ignoreDismissRef.current = true;
    const timer = window.setTimeout(() => {
      ignoreDismissRef.current = false;
    }, 100);
    return () => window.clearTimeout(timer);
  }, [dialog]);

  const title = isDelete ? labels.recurrenceScopeDeleteTitle : labels.recurrenceScopeEditTitle;
  const description =
    dialog?.description ??
    (isDelete ? labels.recurrenceScopeDeleteDescription : labels.recurrenceScopeEditDescription);

  const close = (scope: RecurrenceScopeChoice | null) => {
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
        className="calendar-dialog-surface calendar-recurrence-scope-dialog"
        onPointerDownOutside={preventPrematureDismiss}
        onInteractOutside={preventPrematureDismiss}
        onFocusOutside={preventPrematureDismiss}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="calendar-recurrence-scope" role="group" aria-label={title}>
          <Button
            type="button"
            variant="primary"
            className="calendar-recurrence-scope__action"
            onClick={() => close("thisInstance")}
          >
            {labels.recurrenceScopeThisInstance}
          </Button>
          <Button
            type="button"
            variant="subtle"
            className="calendar-recurrence-scope__action"
            onClick={() => close("thisAndFuture")}
          >
            {labels.recurrenceScopeThisAndFuture}
          </Button>
          {isDelete ? (
            <Button
              type="button"
              variant="subtle"
              className="calendar-recurrence-scope__action"
              onClick={() => close("allInstances")}
            >
              {labels.recurrenceScopeAllInstances}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="calendar-recurrence-scope__action"
            onClick={() => close(null)}
          >
            {labels.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
