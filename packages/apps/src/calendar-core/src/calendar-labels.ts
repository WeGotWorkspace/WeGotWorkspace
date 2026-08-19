import { defaultOwnerScopeLabels } from "@/ui/owner-scope-labels";

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
  myCalendarsSection: string;
  teamCalendarsSection: string;
  calendarDirectoryLabel: string;
  calendarDirectoryPersonal: (ownerLabel: string) => string;
  calendarDirectoryGroup: (name: string) => string;
  calendarDirectoryReadOnlyLabel: string;
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
  /** Standalone card heading and select label for busy/free availability. */
  eventShowAs: string;
  eventShowAsBusy: string;
  eventShowAsFree: string;
  eventAlarmsLabel: string;
  eventAlarmsNone: string;
  eventAlarmAdd: string;
  eventAlarmRemove: string;
  eventAlarmAtStart: string;
  eventAlarm5Min: string;
  eventAlarm10Min: string;
  eventAlarm15Min: string;
  eventAlarm30Min: string;
  eventAlarm1Hour: string;
  eventAlarm1Day: string;
  eventAlarmCustom: string;
  eventAlarmCustomAmount: string;
  eventAlarmUnitMinutes: string;
  eventAlarmUnitHours: string;
  eventAlarmUnitDays: string;
  eventRepeatLabel: string;
  eventRecurrenceEndsLabel: string;
  eventRecurrenceEndsNever: string;
  eventRecurrenceEndsOnDate: string;
  eventRecurrenceEndsAfter: string;
  eventRecurrenceEndsCountSuffix: string;
  save: string;
  cancel: string;
  delete: string;
  invitationsSection: string;
  invitationsEmpty: string;
  invitationsDismiss: string;
  eventAttendeesLabel: string;
  eventAttendeesHint: string;
  eventAttendeesAdd: string;
  eventAttendeesEmpty: string;
  eventAttendeesEmailPlaceholder: string;
  eventAttendeesEmailAdd: string;
  eventAttendeesEmailUnavailable: string;
  eventAttendeesRoleRequired: string;
  eventAttendeesRoleOptional: string;
  eventAttendeesRemove: string;
  eventAttendeesSearchEmpty: string;
  eventAttendeesRsvpAccepted: string;
  eventAttendeesRsvpTentative: string;
  eventAttendeesRsvpDeclined: string;
  eventAttendeesRsvpDelegated: string;
  rsvpAccept: string;
  rsvpMaybe: string;
  rsvpDecline: string;
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
  myCalendarsSection: "My calendars",
  teamCalendarsSection: "Team calendars",
  calendarDirectoryLabel: defaultOwnerScopeLabels.label,
  calendarDirectoryPersonal: defaultOwnerScopeLabels.personal,
  calendarDirectoryGroup: defaultOwnerScopeLabels.group,
  calendarDirectoryReadOnlyLabel: defaultOwnerScopeLabels.readOnlyLabel,
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
  eventShowAs: "Show as",
  eventShowAsBusy: "Busy",
  eventShowAsFree: "Free",
  eventAlarmsLabel: "Alarms",
  eventAlarmsNone: "No alarms",
  eventAlarmAdd: "Add alarm",
  eventAlarmRemove: "Remove alarm",
  eventAlarmAtStart: "At time of event",
  eventAlarm5Min: "5 minutes before",
  eventAlarm10Min: "10 minutes before",
  eventAlarm15Min: "15 minutes before",
  eventAlarm30Min: "30 minutes before",
  eventAlarm1Hour: "1 hour before",
  eventAlarm1Day: "1 day before",
  eventAlarmCustom: "Custom",
  eventAlarmCustomAmount: "Time before",
  eventAlarmUnitMinutes: "minutes",
  eventAlarmUnitHours: "hours",
  eventAlarmUnitDays: "days",
  eventRepeatLabel: "Repeat",
  eventRecurrenceEndsLabel: "Ends",
  eventRecurrenceEndsNever: "Never",
  eventRecurrenceEndsOnDate: "On date",
  eventRecurrenceEndsAfter: "After",
  eventRecurrenceEndsCountSuffix: "times",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  invitationsSection: "Invitations",
  invitationsEmpty: "No pending invitations.",
  invitationsDismiss: "Dismiss",
  eventAttendeesLabel: "Invitees",
  eventAttendeesHint: "Add teammates or invite anyone with an email address.",
  eventAttendeesAdd: "Add people",
  eventAttendeesEmpty: "No invitees yet.",
  eventAttendeesEmailPlaceholder: "Add people…",
  eventAttendeesEmailAdd: "Add email",
  eventAttendeesEmailUnavailable:
    "Email delivery is unavailable. External invitees are saved on the event but will not receive an invitation.",
  eventAttendeesRoleRequired: "Required",
  eventAttendeesRoleOptional: "Optional",
  eventAttendeesRemove: "Remove invitee",
  eventAttendeesSearchEmpty: "No teammates found",
  eventAttendeesRsvpAccepted: "Accepted",
  eventAttendeesRsvpTentative: "Maybe",
  eventAttendeesRsvpDeclined: "Declined",
  eventAttendeesRsvpDelegated: "Delegated",
  rsvpAccept: "Accept",
  rsvpMaybe: "Maybe",
  rsvpDecline: "Decline",
};

export function mergeCalendarLabels(overrides?: Partial<CalendarUILabels>): CalendarUILabels {
  return { ...defaultCalendarLabels, ...overrides };
}
