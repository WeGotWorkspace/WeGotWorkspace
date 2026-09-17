import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  CalendarEventForm,
  type CalendarEventFormLayout,
  type CalendarEventFormProps,
} from "@/calendar-core/src/calendar-event-form";

export type CalendarEventDialogLayout = CalendarEventFormLayout;

export type CalendarEventDialogProps = Omit<
  CalendarEventFormProps,
  "className" | "collisionContentClassName" | "autoFocusTitle"
> & {
  open: boolean;
  title?: string;
  contentClassName?: string;
};

/** Create / edit event dialog — form body is shared with the interactive details popover. */
export function CalendarEventDialog({
  open,
  mode,
  title,
  contentClassName = "calendar-dialog-surface calendar-event-dialog",
  labels,
  busy = false,
  onClose,
  ...formProps
}: CalendarEventDialogProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        className={contentClassName}
        lang={formProps.locale}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {title ?? (mode === "create" ? labels.createEventTitle : labels.editEventTitle)}
          </DialogTitle>
        </DialogHeader>
        <CalendarEventForm
          mode={mode}
          labels={labels}
          busy={busy}
          onClose={onClose}
          collisionContentClassName={contentClassName}
          {...formProps}
        />
      </DialogContent>
    </Dialog>
  );
}
