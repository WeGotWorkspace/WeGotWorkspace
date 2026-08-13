export type CalendarUILabels = {
  appTitle: string;
  viewMonth: string;
  viewWeek: string;
  viewDay: string;
  viewAgenda: string;
  today: string;
  previousPeriod: string;
  nextPeriod: string;
  newEvent: string;
  calendarsSection: string;
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
  toastEventSaveFailed: string;
  editEventTitle: string;
  createEventTitle: string;
  eventTitleLabel: string;
  eventCalendarLabel: string;
  eventStartLabel: string;
  eventEndLabel: string;
  eventAllDayLabel: string;
  eventLocationLabel: string;
  save: string;
  cancel: string;
  delete: string;
};

export const defaultCalendarLabels: CalendarUILabels = {
  appTitle: "Calendar",
  viewMonth: "Month",
  viewWeek: "Week",
  viewDay: "Day",
  viewAgenda: "Agenda",
  today: "Today",
  previousPeriod: "Previous",
  nextPeriod: "Next",
  newEvent: "New event",
  calendarsSection: "Calendars",
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
  toastEventSaveFailed: "Could not save event",
  editEventTitle: "Edit event",
  createEventTitle: "New event",
  eventTitleLabel: "Title",
  eventCalendarLabel: "Calendar",
  eventStartLabel: "Starts",
  eventEndLabel: "Ends",
  eventAllDayLabel: "All day",
  eventLocationLabel: "Location",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
};

export function mergeCalendarLabels(overrides?: Partial<CalendarUILabels>): CalendarUILabels {
  return { ...defaultCalendarLabels, ...overrides };
}
