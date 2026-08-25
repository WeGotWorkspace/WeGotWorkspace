import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import {
  CalendarPickerMenuItem,
  defaultPickerCalendarId,
  writableCalendarsForPicker,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import {
  CALENDAR_COLOR_SWATCHES,
  DEFAULT_CALENDAR_COLOR,
} from "@/calendar-core/src/calendar-calendar-dialog";
import { CalendarColorSwatchTrigger } from "@/calendar-core/src/calendar-color-swatch-trigger";
import {
  inferCalendarNameFromIcsFileName,
  NEW_CALENDAR_IMPORT_VALUE,
  type CalendarIcsImportDestination,
} from "@/calendar-core/src/calendar-ics-import";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import "./calendar-import-dialog.css";

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

function defaultDestinationId(calendars: CalendarInfo[], preferredCalendarId?: string): string {
  const writable = writableCalendarsForPicker(calendars);
  return writable.length > 0
    ? defaultPickerCalendarId(calendars, preferredCalendarId)
    : NEW_CALENDAR_IMPORT_VALUE;
}

function defaultNameFromFile(file: File, fallback: string): string {
  return inferCalendarNameFromIcsFileName(file.name) || fallback;
}

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
  const writable = writableCalendarsForPicker(calendars);
  const [destinationId, setDestinationId] = useState(() =>
    defaultDestinationId(calendars, preferredCalendarId),
  );
  const [name, setName] = useState(() => defaultNameFromFile(file, labels.newCalendar));
  const [color, setColor] = useState<string>(DEFAULT_CALENDAR_COLOR);

  useEffect(() => {
    if (!open) return;
    setDestinationId(defaultDestinationId(calendars, preferredCalendarId));
    setName(defaultNameFromFile(file, labels.newCalendar));
    setColor(DEFAULT_CALENDAR_COLOR);
  }, [open, file, calendars, preferredCalendarId, labels.newCalendar]);

  const creating = destinationId === NEW_CALENDAR_IMPORT_VALUE;
  const selectedCalendar = writable.find((calendar) => calendar.id === destinationId);
  const destinationName = creating
    ? labels.newCalendar
    : (selectedCalendar?.name ?? labels.importDestinationLegend);
  const destinationReady = creating ? name.trim() !== "" : destinationId.trim() !== "";
  const canSubmit = destinationReady && !busy;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="calendar-dialog-surface" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.importDialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="calendar-import-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onImport(
              file,
              creating
                ? {
                    mode: "create",
                    name: name.trim(),
                    color: color.trim() || DEFAULT_CALENDAR_COLOR,
                  }
                : { mode: "existing", calendarId: destinationId },
            );
          }}
        >
          {error ? <Callout severity="error" title={error} /> : null}
          <FieldLabelRow
            label={labels.importDestinationLegend}
            htmlFor="calendar-import-destination"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <CalendarColorSwatchTrigger
                  id="calendar-import-destination"
                  color={selectedCalendar?.color}
                  showSwatch={!creating}
                  label={`${labels.importDestinationLegend}: ${destinationName}`}
                  className="calendar-import-dialog__destination"
                  disabled={busy}
                >
                  {destinationName}
                </CalendarColorSwatchTrigger>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="calendar-event-dialog__calendar-menu calendar-import-dialog__destination-menu"
              >
                {writable.map((calendar) => (
                  <CalendarPickerMenuItem
                    key={calendar.id}
                    name={calendar.name}
                    color={calendar.color}
                    selected={destinationId === calendar.id}
                    onSelect={() => setDestinationId(calendar.id)}
                  />
                ))}
                {writable.length > 0 ? <DropdownMenuSeparator /> : null}
                <CalendarPickerMenuItem
                  name={labels.newCalendar}
                  selected={creating}
                  onSelect={() => setDestinationId(NEW_CALENDAR_IMPORT_VALUE)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </FieldLabelRow>
          {creating ? (
            <div className="calendar-import-dialog__create-fields">
              <FieldLabelRow label={labels.calendarNameLabel} htmlFor="calendar-import-name">
                <div className="calendar-import-dialog__name-color-row">
                  <Input
                    id="calendar-import-name"
                    className="calendar-import-dialog__name-input"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <SwatchColorPicker
                    value={color}
                    onChange={setColor}
                    colorLabel={labels.calendarColorLabel}
                    swatches={CALENDAR_COLOR_SWATCHES}
                  >
                    <CalendarColorSwatchTrigger
                      color={color}
                      label={labels.calendarColorLabel}
                      aria-haspopup="dialog"
                    />
                  </SwatchColorPicker>
                </div>
              </FieldLabelRow>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              label={labels.cancel}
              disabled={busy}
              onClick={onClose}
            />
            <Button type="submit" label={labels.importSubmit} disabled={!canSubmit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
