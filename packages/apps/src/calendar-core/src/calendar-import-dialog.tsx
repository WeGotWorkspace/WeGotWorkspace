import {
  defaultPickerCalendarId,
  writableCalendarsForPicker,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import {
  CALENDAR_COLOR_SWATCHES,
  DEFAULT_CALENDAR_COLOR,
} from "@/calendar-core/src/calendar-calendar-dialog";
import type { CalendarIcsImportDestination } from "@/calendar-core/src/calendar-ics-import";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { IcsImportDialog } from "@/lib/ics-import/ics-import-dialog";

export type CalendarImportDialogProps = {
  open: boolean;
  file: File;
  labels: CalendarUILabels;
  calendars: CalendarInfo[];
  preferredCalendarId?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onImport: (file: File, destination: CalendarIcsImportDestination) => void;
};

export function CalendarImportDialog({
  open,
  file,
  labels,
  calendars,
  preferredCalendarId,
  busy = false,
  error = null,
  onClose,
  onImport,
}: CalendarImportDialogProps) {
  return (
    <IcsImportDialog
      open={open}
      file={file}
      idPrefix="calendar"
      contentClassName="calendar-dialog-surface"
      labels={{
        title: labels.importDialogTitle,
        destinationLegend: labels.importDestinationLegend,
        newCollection: labels.newCalendar,
        nameLabel: labels.calendarNameLabel,
        colorLabel: labels.calendarColorLabel,
        cancel: labels.cancel,
        submit: labels.importSubmit,
      }}
      collections={writableCalendarsForPicker(calendars)}
      defaultCollectionId={defaultPickerCalendarId(calendars, preferredCalendarId)}
      swatches={CALENDAR_COLOR_SWATCHES}
      defaultColor={DEFAULT_CALENDAR_COLOR}
      busy={busy}
      error={error}
      onClose={onClose}
      onImport={(importFile, destination) =>
        onImport(
          importFile,
          destination.mode === "create"
            ? destination
            : { mode: "existing", calendarId: destination.collectionId },
        )
      }
    />
  );
}
