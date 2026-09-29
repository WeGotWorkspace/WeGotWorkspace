import { Check } from "lucide-react";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import type { ControlSize } from "@/ui/control-size";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import "@/lib/calendar-event-calendar-picker.css";

export type CalendarPickerCalendar = {
  id: string;
  name: string;
  color: string;
  mayWrite?: boolean;
};

export type CalendarPickerMenuItemProps = {
  name: string;
  selected: boolean;
  onSelect: () => void;
  /** Omit for action rows (e.g. New calendar) that should not show a color dot. */
  color?: string;
};

/** Shared calendar option: color dot + name + check, matching the event-dialog picker. */
export function CalendarPickerMenuItem({
  name,
  color,
  selected,
  onSelect,
}: CalendarPickerMenuItemProps) {
  return (
    <DropdownMenuItem className="calendar-event-dialog__calendar-option" onSelect={onSelect}>
      {color != null && color !== "" ? (
        <span className="calendar-sidebar-dot" style={{ backgroundColor: color }} aria-hidden />
      ) : null}
      <span className="calendar-event-dialog__calendar-name">{name}</span>
      <Check
        className={cn(
          "calendar-event-dialog__calendar-check",
          selected ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
    </DropdownMenuItem>
  );
}

export type CalendarEventCalendarPickerProps = {
  calendars: CalendarPickerCalendar[];
  calendarId: string;
  label: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** Shared control height. Default `md`. */
  size?: ControlSize;
  onCalendarIdChange: (calendarId: string) => void;
};

export function writableCalendarsForPicker(
  calendars: CalendarPickerCalendar[],
): CalendarPickerCalendar[] {
  return calendars.filter((calendar) => calendar.mayWrite !== false);
}

export function defaultPickerCalendarId(
  calendars: CalendarPickerCalendar[],
  preferredId?: string,
): string {
  const writable = writableCalendarsForPicker(calendars);
  if (preferredId && writable.some((calendar) => calendar.id === preferredId)) {
    return preferredId;
  }
  return writable[0]?.id ?? "";
}

/** Event-dialog calendar switcher — reused on invitation cards and Calendar settings. */
export function CalendarEventCalendarPicker({
  calendars,
  calendarId,
  label,
  disabled = false,
  triggerClassName = "calendar-event-dialog__calendar-trigger",
  size = "md",
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
        <ColorSwatchTrigger
          color={selectedCalendar?.color ?? "transparent"}
          label={selectedCalendar ? `${label}: ${selectedCalendar.name}` : label}
          className={triggerClassName}
          size={size}
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-event-dialog__calendar-menu">
        {writableCalendars.map((calendar) => (
          <CalendarPickerMenuItem
            key={calendar.id}
            name={calendar.name}
            color={calendar.color}
            selected={calendarId === calendar.id}
            onSelect={() => onCalendarIdChange(calendar.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
