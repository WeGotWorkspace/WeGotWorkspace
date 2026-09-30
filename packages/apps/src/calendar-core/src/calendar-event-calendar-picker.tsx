import {
  CalendarEventCalendarPicker as CalendarPicker,
  type CalendarEventCalendarPickerProps as CalendarPickerProps,
  type CalendarPickerCalendar,
} from "@/lib/calendar-event-calendar-picker";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

export {
  CalendarPickerMenuItem,
  defaultPickerCalendarId,
  writableCalendarsForPicker,
  type CalendarPickerCalendar,
  type CalendarPickerMenuItemProps,
} from "@/lib/calendar-event-calendar-picker";

export type CalendarEventCalendarPickerProps = Omit<CalendarPickerProps, "label" | "calendars"> & {
  calendars: CalendarInfo[] | CalendarPickerCalendar[];
  labels: CalendarUILabels;
};

/** Event-dialog calendar switcher — reused on invitation cards. */
export function CalendarEventCalendarPicker({
  labels,
  ...props
}: CalendarEventCalendarPickerProps) {
  return <CalendarPicker {...props} label={labels.eventCalendarLabel} />;
}
