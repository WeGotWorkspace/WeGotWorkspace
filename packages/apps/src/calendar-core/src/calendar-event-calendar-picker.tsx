import { Check } from "lucide-react";
import { CalendarColorSwatchTrigger } from "@/calendar-core/src/calendar-color-swatch-trigger";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

export type CalendarEventCalendarPickerProps = {
  calendars: CalendarInfo[];
  calendarId: string;
  labels: CalendarUILabels;
  disabled?: boolean;
  triggerClassName?: string;
  onCalendarIdChange: (calendarId: string) => void;
};

export function writableCalendarsForPicker(calendars: CalendarInfo[]): CalendarInfo[] {
  return calendars.filter((calendar) => calendar.mayWrite !== false);
}

export function defaultPickerCalendarId(calendars: CalendarInfo[], preferredId?: string): string {
  const writable = writableCalendarsForPicker(calendars);
  if (preferredId && writable.some((calendar) => calendar.id === preferredId)) {
    return preferredId;
  }
  return writable[0]?.id ?? "";
}

/** Event-dialog calendar switcher — reused on invitation cards. */
export function CalendarEventCalendarPicker({
  calendars,
  calendarId,
  labels,
  disabled = false,
  triggerClassName = "calendar-event-dialog__calendar-trigger",
  onCalendarIdChange,
}: CalendarEventCalendarPickerProps) {
  const writableCalendars = writableCalendarsForPicker(calendars);
  const selectedCalendar =
    writableCalendars.find((calendar) => calendar.id === calendarId) ?? writableCalendars[0];

  if (writableCalendars.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CalendarColorSwatchTrigger
          color={selectedCalendar?.color ?? "transparent"}
          label={
            selectedCalendar
              ? `${labels.eventCalendarLabel}: ${selectedCalendar.name}`
              : labels.eventCalendarLabel
          }
          className={triggerClassName}
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-event-dialog__calendar-menu">
        {writableCalendars.map((calendar) => (
          <DropdownMenuItem
            key={calendar.id}
            className="calendar-event-dialog__calendar-option"
            onSelect={() => onCalendarIdChange(calendar.id)}
          >
            <span
              className="calendar-sidebar-dot"
              style={{ backgroundColor: calendar.color }}
              aria-hidden
            />
            <span className="calendar-event-dialog__calendar-name">{calendar.name}</span>
            <Check
              className={cn(
                "calendar-event-dialog__calendar-check",
                calendarId === calendar.id ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
