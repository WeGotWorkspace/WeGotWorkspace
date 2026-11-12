import { Circle } from "lucide-react";
import {
  CalendarEventForm,
  type CalendarEventFormProps,
} from "@/calendar-core/src/calendar-event-form";
import type { CalendarEventPreviewModel } from "@/calendar-core/src/calendar-event-preview";
import type { CalendarEventDetailsPopoverEditProps } from "@/calendar-core/src/calendar-event-details-popover";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import "@/note-detail-view/src/note-detail-view.css";
import "@/note-detail-view/src/note-detail-desk.css";
import "./calendar-event-pane.css";

const noop = () => undefined;

export type CalendarEventPaneProps = {
  preview: CalendarEventPreviewModel;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  locale: string;
  busy?: boolean;
  pendingSync?: boolean;
  /** The event's form and its handlers; without it changes go nowhere. */
  edit?: CalendarEventDetailsPopoverEditProps;
};

/**
 * List mode's detail: the event form on the suite detail sheet (same measure as a task
 * or a note), with the calendar dropdown above a large title. It saves as you go
 * (the host autosaves); Delete sits in the pane's header.
 */
export function CalendarEventPane({
  preview,
  calendars,
  labels,
  locale,
  busy = false,
  pendingSync = false,
  edit,
}: CalendarEventPaneProps) {
  const { mode = "edit", ...formProps }: CalendarEventDetailsPopoverEditProps = edit ?? {
    form: preview.form,
    onChange: noop,
    onClose: noop,
    onSave: noop,
  };
  const form: CalendarEventFormProps = {
    ...formProps,
    mode,
    calendars,
    labels,
    locale,
    busy: busy || Boolean(formProps.busy),
    availabilityEventId: mode === "edit" ? preview.eventId : undefined,
    autoFocusTitle: false,
    heading: true,
    autosave: true,
    onDelete: undefined,
  };
  return (
    <article className="note-detail-view paper-sheet calendar-event-pane" lang={locale}>
      {pendingSync ? (
        <span
          className="calendar-event-pane__pending-sync"
          role="img"
          aria-label={labels.pendingSync}
        >
          <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
        </span>
      ) : null}
      <CalendarEventForm {...form} />
    </article>
  );
}
