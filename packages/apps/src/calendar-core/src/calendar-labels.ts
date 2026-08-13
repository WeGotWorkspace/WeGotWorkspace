export type CalendarUILabels = {
  appTitle: string;
  viewMonth: string;
  viewWeek: string;
  viewDay: string;
  viewYear: string;
  viewAgenda: string;
  viewSelectLabel: string;
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
  refreshList: string;
  toastListUpdated: string;
  toastListRefreshFailed: string;
  toastEventCreated: string;
  toastEventUpdated: string;
  toastEventDeleted: string;
  toastEventDeleteUndone: string;
  toastEventSaveFailed: string;
  recurrenceScopeEditTitle: string;
  recurrenceScopeDeleteTitle: string;
  recurrenceScopeAll: string;
  recurrenceScopeThisAndFuture: string;
  recurrenceScopeContinue: string;
  editEventTitle: string;
  createEventTitle: string;
  eventTitleLabel: string;
  eventCalendarLabel: string;
  eventStartLabel: string;
  eventEndLabel: string;
  eventAllDayLabel: string;
  eventLocationLabel: string;
  eventNotesLabel: string;
  eventRepeatLabel: string;
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
  viewAgenda: "List",
  viewSelectLabel: "Calendar view",
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
  refreshList: "Refresh",
  toastListUpdated: "Calendar updated",
  toastListRefreshFailed: "Could not refresh calendar",
  toastEventCreated: "Event created",
  toastEventUpdated: "Event updated",
  toastEventDeleted: "Event deleted",
  toastEventDeleteUndone: "Deletion undone.",
  toastEventSaveFailed: "Could not save event",
  recurrenceScopeEditTitle: "Edit recurring event",
  recurrenceScopeDeleteTitle: "Delete recurring event",
  recurrenceScopeAll: "All instances",
  recurrenceScopeThisAndFuture: "This and future instances",
  recurrenceScopeContinue: "Continue",
  editEventTitle: "Edit event",
  createEventTitle: "New event",
  eventTitleLabel: "Title",
  eventCalendarLabel: "Calendar",
  eventStartLabel: "Starts",
  eventEndLabel: "Ends",
  eventAllDayLabel: "All day",
  eventLocationLabel: "Location",
  eventNotesLabel: "Notes",
  eventRepeatLabel: "Repeat",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
};

export function mergeCalendarLabels(overrides?: Partial<CalendarUILabels>): CalendarUILabels {
  return { ...defaultCalendarLabels, ...overrides };
}
