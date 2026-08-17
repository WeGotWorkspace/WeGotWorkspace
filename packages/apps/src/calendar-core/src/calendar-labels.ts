export type CalendarUILabels = {
  appTitle: string;
  viewMonth: string;
  viewWeek: string;
  viewDay: string;
  viewYear: string;
  viewSelectLabel: string;
  showAsList: string;
  showAsCalendar: string;
  today: string;
  previousPeriod: string;
  nextPeriod: string;
  newEvent: string;
  calendarsSection: string;
  newCalendar: string;
  editCalendar: string;
  editCalendarTitle: string;
  createCalendarTitle: string;
  calendarNameLabel: string;
  calendarColorLabel: string;
  deleteCalendar: string;
  deleteCalendarConfirmTitle: string;
  deleteCalendarConfirmDescription: string;
  toastCalendarCreated: string;
  toastCalendarUpdated: string;
  toastCalendarDeleted: string;
  toastCalendarSaveFailed: string;
  viewsSection: string;
  untitledEvent: string;
  allDay: string;
  noEventsInRange: string;
  toastEventCreated: string;
  toastEventUpdated: string;
  toastEventDeleted: string;
  toastEventDeleteUndone: string;
  toastEventSaveFailed: string;
  recurrenceScopeEditTitle: string;
  recurrenceScopeDeleteTitle: string;
  recurrenceScopeEditDescription: string;
  recurrenceScopeDeleteDescription: string;
  recurrenceScopeThisInstance: string;
  recurrenceScopeThisAndFuture: string;
  /** Delete only — destroy the master series. */
  recurrenceScopeAllInstances: string;
  editEventTitle: string;
  createEventTitle: string;
  eventTitleLabel: string;
  eventCalendarLabel: string;
  eventStartLabel: string;
  eventEndLabel: string;
  eventAllDayLabel: string;
  /** Card heading for all-day, start, end, and time zone. */
  eventWhenSectionTitle: string;
  eventTimeZoneLabel: string;
  /** Floating / wall-clock option (no fixed TZID). */
  eventTimeZoneLocalLabel: string;
  eventLocationLabel: string;
  eventNotesLabel: string;
  eventRepeatLabel: string;
  eventRecurrenceEndsLabel: string;
  eventRecurrenceEndsNever: string;
  eventRecurrenceEndsOnDate: string;
  eventRecurrenceEndsAfter: string;
  eventRecurrenceEndsCountSuffix: string;
  save: string;
  cancel: string;
  delete: string;
};

export const defaultCalendarLabels: CalendarUILabels = {
  appTitle: "Calendar",
  viewMonth: "Month",
  viewWeek: "Week",
  viewDay: "Day",
  viewYear: "Year",
  viewSelectLabel: "Calendar view",
  showAsList: "List view",
  showAsCalendar: "Calendar view",
  today: "Today",
  previousPeriod: "Previous",
  nextPeriod: "Next",
  newEvent: "New event",
  calendarsSection: "Calendars",
  newCalendar: "New calendar",
  editCalendar: "Edit calendar",
  editCalendarTitle: "Edit calendar",
  createCalendarTitle: "New calendar",
  calendarNameLabel: "Name",
  calendarColorLabel: "Color",
  deleteCalendar: "Delete calendar",
  deleteCalendarConfirmTitle: "Delete calendar?",
  deleteCalendarConfirmDescription:
    "Events on this calendar will be permanently deleted. This cannot be undone.",
  toastCalendarCreated: "Calendar created",
  toastCalendarUpdated: "Calendar updated",
  toastCalendarDeleted: "Calendar deleted",
  toastCalendarSaveFailed: "Could not save calendar",
  viewsSection: "Views",
  untitledEvent: "Untitled event",
  allDay: "All day",
  noEventsInRange: "No events in this period.",
  toastEventCreated: "Event created",
  toastEventUpdated: "Event updated",
  toastEventDeleted: "Event deleted",
  toastEventDeleteUndone: "Deletion undone.",
  toastEventSaveFailed: "Could not save event",
  recurrenceScopeEditTitle: "You're changing a repeating event.",
  recurrenceScopeDeleteTitle: "You're deleting a repeating event.",
  recurrenceScopeEditDescription:
    "Do you want to change only this occurrence, or this and all future events?",
  recurrenceScopeDeleteDescription:
    "Do you want to delete only this occurrence, this and all future events, or the entire series?",
  recurrenceScopeThisInstance: "Only this event",
  recurrenceScopeThisAndFuture: "All future events",
  recurrenceScopeAllInstances: "All events",
  editEventTitle: "Edit event",
  createEventTitle: "New event",
  eventTitleLabel: "Title",
  eventCalendarLabel: "Calendar",
  eventStartLabel: "Starts",
  eventEndLabel: "Ends",
  eventAllDayLabel: "All day",
  eventWhenSectionTitle: "When",
  eventTimeZoneLabel: "Time zone",
  eventTimeZoneLocalLabel: "Local (floating)",
  eventLocationLabel: "Location",
  eventNotesLabel: "Notes",
  eventRepeatLabel: "Repeat",
  eventRecurrenceEndsLabel: "Ends",
  eventRecurrenceEndsNever: "Never",
  eventRecurrenceEndsOnDate: "On date",
  eventRecurrenceEndsAfter: "After",
  eventRecurrenceEndsCountSuffix: "times",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
};

export function mergeCalendarLabels(overrides?: Partial<CalendarUILabels>): CalendarUILabels {
  return { ...defaultCalendarLabels, ...overrides };
}
