import type { CalendarPresentation, CalendarViewId } from "@/lib/models/calendar-types";
import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

export const CALENDAR_VIEW_PREFS_STORAGE_KEY = "wgw.ui.calendar.viewPrefs";

export type CalendarViewPrefs = {
  view?: CalendarViewId;
  presentation?: CalendarPresentation;
  hiddenCalendarIds?: string[];
  /** Calendar ids present the last time hidden prefs were written on this device. */
  knownCalendarIds?: string[];
  /**
   * Task-list ids hidden on the Calendar overlay only. Independent of Tasks
   * `hiddenTaskListIds`. Default (omitted / empty) = every list shown.
   */
  hiddenOverlayTaskListIds?: string[];
  /** Teammates ticked in Team availability. Default (omitted) = nobody: rows start hidden. */
  shownAvailabilityIds?: string[];
  /** Team availability section folded on this device. */
  availabilityCollapsed?: boolean;
  /** Reminders section folded on this device. */
  remindersCollapsed?: boolean;
  /** My calendars section folded on this device. */
  myCalendarsCollapsed?: boolean;
};

/** View prefs that remember whether a sidebar section is folded. */
export type CalendarSectionCollapsedPref =
  "availabilityCollapsed" | "remindersCollapsed" | "myCalendarsCollapsed";

export const calendarViewPrefs = createViewPrefsStore<CalendarViewPrefs>(
  CALENDAR_VIEW_PREFS_STORAGE_KEY,
  {
    view: viewPrefsField.oneOf<CalendarViewId>(["day", "week", "month", "year"]),
    presentation: viewPrefsField.oneOf<CalendarPresentation>(["grid", "list"]),
    hiddenCalendarIds: viewPrefsField.idList,
    knownCalendarIds: viewPrefsField.idList,
    hiddenOverlayTaskListIds: viewPrefsField.idList,
    shownAvailabilityIds: viewPrefsField.idList,
    availabilityCollapsed: viewPrefsField.boolean,
    remindersCollapsed: viewPrefsField.boolean,
    myCalendarsCollapsed: viewPrefsField.boolean,
  },
);

export const calendarHiddenCalendars = calendarViewPrefs.hiddenCollection(
  "hiddenCalendarIds",
  "knownCalendarIds",
);
