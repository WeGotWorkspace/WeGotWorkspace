import { CALENDAR_LIST_EMPTY_LABEL } from "@/lib/calendar-elements/CalendarListView/calendar-list-empty-label";
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
  /** Accessible name for the New event menu chevron. */
  newEventMenu: string;
  importIcs: string;
  importDialogTitle: string;
  importFileInvalid: string;
  importDestinationLegend: string;
  importSubmit: string;
  toastImportSuccess: string;
  toastImportPartial: string;
  toastImportFailed: string;
  toastImportOffline: string;
  calendarsSection: string;
  myCalendarsSection: string;
  teamCalendarsSection: string;
  sharedWithMeSection: string;
  subscribedCalendarsSection: string;
  teamCalendarBadge: string;
  viewOnlyCalendarBadge: string;
  calendarDirectoryLabel: string;
  calendarDirectoryPersonal: (ownerLabel: string) => string;
  calendarDirectoryGroup: (name: string) => string;
  calendarDirectoryReadOnlyLabel: string;
  newCalendar: string;
  createCalendar: string;
  editCalendar: string;
  editCalendarTitle: string;
  createCalendarTitle: string;
  calendarNameLabel: string;
  calendarColorLabel: string;
  deleteCalendar: string;
  deleteCalendarConfirmTitle: string;
  deleteCalendarConfirmDescription: string;
  subscribeCalendar: string;
  subscribeCalendarTitle: string;
  subscribeUrlLabel: string;
  subscribeUrlPlaceholder: string;
  unsubscribeCalendar: string;
  unsubscribeCalendarConfirmTitle: string;
  unsubscribeCalendarConfirmDescription: string;
  removeSharedCalendar: string;
  removeSharedCalendarConfirmTitle: string;
  removeSharedCalendarConfirmDescription: string;
  /** Tooltip / accessible name for the subscribed-calendar sidebar mark. */
  subscribedCalendarBadge: string;
  publishCalendarTitle: string;
  publishCalendarEnabledHint: string;
  publishCalendarDisabledHint: string;
  publishCalendarHttpsLabel: string;
  copyHttpsUrl: string;
  /** Tooltip / accessible name for the webcal:// subscribe link. */
  openInCalendar: string;
  unpublishCalendarTitle: string;
  unpublishCalendarDescription: string;
  unpublishCalendarConfirm: string;
  toastCalendarCreated: string;
  toastCalendarUpdated: string;
  toastCalendarDeleted: string;
  toastCalendarSubscribed: string;
  toastCalendarUnsubscribed: string;
  toastCalendarShareRemoved: string;
  toastCalendarSubscribeFailed: string;
  toastFeedPublished: string;
  toastFeedUnpublished: string;
  toastFeedCopied: string;
  toastFeedFailed: string;
  toastCalendarSaveFailed: string;
  viewsSection: string;
  untitledEvent: string;
  allDay: string;
  noEventsInRange: string;
  toastEventCreated: string;
  toastEventUpdated: string;
  toastEventSaveUndone: string;
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
  /** Compact details popover — opens the existing event dialog. */
  eventDetailsEdit: string;
  eventDetailsMoreInvitees: (count: number) => string;
  /** Standalone card heading and select label for busy/free availability. */
  eventShowAs: string;
  eventShowAsBusy: string;
  eventShowAsFree: string;
  eventAlarmsLabel: string;
  eventAlarmsNone: string;
  eventAlarmAdd: string;
  eventAlarmRemove: string;
  /** Visible label on each alarm row (not the card title). */
  eventAlarmRow: string;
  /** Empty offset option and trailing unused slot. */
  eventAlarmNone: string;
  /** Offset select on a single alarm row (not the card title). */
  eventAlarmOffset: string;
  eventAlarmAtStart: string;
  eventAlarm5Min: string;
  eventAlarm10Min: string;
  eventAlarm15Min: string;
  eventAlarm30Min: string;
  eventAlarm1Hour: string;
  eventAlarm1Day: string;
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
  invitationsEmptyResponded: string;
  invitationsDismiss: string;
  invitationsClosePanel: string;
  invitationsCountOne: string;
  invitationsCountMany: (count: number) => string;
  invitationsRespondedCountOne: string;
  invitationsRespondedCountMany: (count: number) => string;
  invitationsTabNew: string;
  invitationsTabResponded: string;
  invitationsFilterAria: string;
  invitationsToggleShow: string;
  invitationsToggleHide: string;
  invitationsOrganizerUnknown: string;
  eventAttendeesLabel: string;
  eventAttendeesHint: string;
  eventAttendeesAdd: string;
  eventAttendeesEmpty: string;
  eventAttendeesEmailPlaceholder: string;
  eventAttendeesEmailAdd: string;
  eventAttendeesEmailUnavailable: string;
  eventAttendeesRemove: string;
  eventAttendeesSearchEmpty: string;
  eventAttendeesOrganizer: string;
  eventAttendeesRsvpAccepted: string;
  eventAttendeesRsvpTentative: string;
  eventAttendeesRsvpDeclined: string;
  eventAttendeesRsvpDelegated: string;
  eventAttendeesRsvpNeedsAction: string;
  rsvpAccept: string;
  rsvpMaybe: string;
  rsvpDecline: string;
  rsvpLabel: string;
  rsvpRespond: string;
  rsvpSeriesHint: string;
  toastRsvpFailed: string;
  toastRsvpUpdated: string;
  toastRsvpUndone: string;
  toastInvitationCancelled: string;
  pendingSync: string;
  shareCalendarSectionTitle: string;
  shareCalendarSectionHint: string;
  shareCalendarAddPlaceholder: string;
  shareCalendarSearchEmpty: string;
  shareCalendarOffline: string;
  shareCalendarFailed: string;
  sharedCalendar: string;
  removeCalendarShareTitle: string;
  removeCalendarShareConfirm: string;
  conflictTitle: string;
  conflictDescription: (title: string) => string;
  conflictRemaining: (count: number) => string;
  conflictKeepMine: string;
  conflictUseServer: string;
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
  newEventMenu: "More calendar actions",
  importIcs: "Import ICS",
  importDialogTitle: "Import events",
  importFileInvalid: "Choose an .ics file",
  importDestinationLegend: "Destination calendar",
  importSubmit: "Import",
  toastImportSuccess: "Events imported",
  toastImportPartial: "Some events could not be imported",
  toastImportFailed: "Could not import events",
  toastImportOffline: "ICS import requires an internet connection",
  calendarsSection: "Calendars",
  myCalendarsSection: "My calendars",
  teamCalendarsSection: "Team calendars",
  sharedWithMeSection: "Shared with me",
  subscribedCalendarsSection: "Subscriptions",
  teamCalendarBadge: "Team calendar",
  viewOnlyCalendarBadge: "View only",
  calendarDirectoryLabel: defaultOwnerScopeLabels.label,
  calendarDirectoryPersonal: defaultOwnerScopeLabels.personal,
  calendarDirectoryGroup: defaultOwnerScopeLabels.group,
  calendarDirectoryReadOnlyLabel: defaultOwnerScopeLabels.readOnlyLabel,
  newCalendar: "New calendar",
  createCalendar: "Create calendar",
  editCalendar: "Edit calendar",
  editCalendarTitle: "Edit calendar",
  createCalendarTitle: "New calendar",
  calendarNameLabel: "Name",
  calendarColorLabel: "Color",
  deleteCalendar: "Delete calendar",
  deleteCalendarConfirmTitle: "Delete calendar?",
  deleteCalendarConfirmDescription:
    "Events on this calendar will be permanently deleted. This cannot be undone.",
  subscribeCalendar: "Subscribe to a calendar",
  subscribeCalendarTitle: "Subscribe to calendar",
  subscribeUrlLabel: "Calendar URL",
  subscribeUrlPlaceholder: "https://… or webcal://…",
  unsubscribeCalendar: "Unsubscribe",
  unsubscribeCalendarConfirmTitle: "Unsubscribe?",
  unsubscribeCalendarConfirmDescription:
    "This removes the subscribed calendar and its events. The remote feed is unchanged.",
  removeSharedCalendar: "Remove calendar",
  removeSharedCalendarConfirmTitle: "Remove this calendar?",
  removeSharedCalendarConfirmDescription:
    "It disappears from your list. The owner’s share is unchanged, so it can be added again later.",
  subscribedCalendarBadge: "Subscribed calendar",
  publishCalendarTitle: "Public feed",
  publishCalendarEnabledHint: "Anyone with the link can subscribe in Google, Apple, or Outlook.",
  publishCalendarDisabledHint: "Turn on to publish this calendar as an ICS / webcal feed.",
  publishCalendarHttpsLabel: "Web address",
  copyHttpsUrl: "Copy link",
  openInCalendar: "Open in Calendar",
  unpublishCalendarTitle: "Stop publishing?",
  unpublishCalendarDescription:
    "The feed URL will stop working. You can publish again later with a new URL.",
  unpublishCalendarConfirm: "Stop publishing",
  toastCalendarCreated: "Calendar created",
  toastCalendarUpdated: "Calendar updated",
  toastCalendarDeleted: "Calendar deleted",
  toastCalendarSubscribed: "Calendar subscribed",
  toastCalendarUnsubscribed: "Unsubscribed",
  toastCalendarShareRemoved: "Calendar removed",
  toastCalendarSubscribeFailed: "Could not subscribe to calendar",
  toastFeedPublished: "Calendar published",
  toastFeedUnpublished: "Feed unpublished",
  toastFeedCopied: "Link copied",
  toastFeedFailed: "Could not update calendar feed",
  toastCalendarSaveFailed: "Could not save calendar",
  viewsSection: "Views",
  untitledEvent: "Untitled event",
  allDay: "All day",
  noEventsInRange: CALENDAR_LIST_EMPTY_LABEL,
  toastEventCreated: "Event created",
  toastEventUpdated: "Event updated",
  toastEventSaveUndone: "Event change undone.",
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
  eventDetailsEdit: "Edit",
  eventDetailsMoreInvitees: (count) => (count === 1 ? "+1 more" : `+${count} more`),
  eventShowAs: "Show as",
  eventShowAsBusy: "Busy",
  eventShowAsFree: "Free",
  eventAlarmsLabel: "Alarms",
  eventAlarmsNone: "No alarms",
  eventAlarmAdd: "Add alert",
  eventAlarmRemove: "Remove alert",
  eventAlarmRow: "Alert",
  eventAlarmNone: "None",
  eventAlarmOffset: "Alert time",
  eventAlarmAtStart: "At time of event",
  eventAlarm5Min: "5 minutes before",
  eventAlarm10Min: "10 minutes before",
  eventAlarm15Min: "15 minutes before",
  eventAlarm30Min: "30 minutes before",
  eventAlarm1Hour: "1 hour before",
  eventAlarm1Day: "1 day before",
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
  invitationsEmpty: "No pending invitations. Invites you receive will appear here.",
  invitationsEmptyResponded: "No responded invitations yet.",
  invitationsDismiss: "Dismiss",
  invitationsClosePanel: "Close invitations",
  invitationsCountOne: "1 pending",
  invitationsCountMany: (count: number) => `${count} pending`,
  invitationsRespondedCountOne: "1 responded",
  invitationsRespondedCountMany: (count: number) => `${count} responded`,
  invitationsTabNew: "New",
  invitationsTabResponded: "Responded",
  invitationsFilterAria: "Invitation inbox",
  invitationsToggleShow: "Show invitations",
  invitationsToggleHide: "Hide invitations",
  invitationsOrganizerUnknown: "Organizer",
  eventAttendeesLabel: "Invitees",
  eventAttendeesHint: "Add teammates or invite anyone with an email address.",
  eventAttendeesAdd: "Add people",
  eventAttendeesEmpty: "No invitees yet.",
  eventAttendeesEmailPlaceholder: "Add people…",
  eventAttendeesEmailAdd: "Add email",
  eventAttendeesEmailUnavailable:
    "Email delivery is unavailable. External invitees are saved on the event but will not receive an invitation.",
  eventAttendeesRemove: "Remove invitee",
  eventAttendeesSearchEmpty: "No teammates found",
  eventAttendeesOrganizer: "Organizer",
  eventAttendeesRsvpAccepted: "Accepted",
  eventAttendeesRsvpTentative: "Maybe",
  eventAttendeesRsvpDeclined: "Declined",
  eventAttendeesRsvpDelegated: "Delegated",
  eventAttendeesRsvpNeedsAction: "Needs response",
  rsvpAccept: "Accept",
  rsvpMaybe: "Maybe",
  rsvpDecline: "Decline",
  rsvpLabel: "RSVP",
  rsvpRespond: "Respond",
  rsvpSeriesHint: "Accept and Decline apply to the entire series.",
  toastRsvpFailed: "Could not send RSVP",
  toastRsvpUpdated: "Invitation updated",
  toastRsvpUndone: "Invitation change undone.",
  toastInvitationCancelled: "This invitation was cancelled",
  pendingSync: "Pending sync",
  shareCalendarSectionTitle: "Team access",
  shareCalendarSectionHint: "Grant read or read-and-write access to people or groups.",
  shareCalendarAddPlaceholder: "Add people or groups…",
  shareCalendarSearchEmpty: "No people or groups found",
  shareCalendarOffline: "Sharing changes require a connection.",
  shareCalendarFailed: "Could not update sharing.",
  sharedCalendar: "Shared with you",
  removeCalendarShareTitle: "Remove access?",
  removeCalendarShareConfirm: "This person or group will lose access to this calendar. Continue?",
  conflictTitle: "Sync conflict",
  conflictDescription: (title) =>
    `"${title}" was changed on the server while you were offline. Keep your version or use the server copy?`,
  conflictRemaining: (count) =>
    count === 1 ? "1 more conflict waiting" : `${count} more conflicts waiting`,
  conflictKeepMine: "Keep mine",
  conflictUseServer: "Use server",
};

export function mergeCalendarLabels(overrides?: Partial<CalendarUILabels>): CalendarUILabels {
  return { ...defaultCalendarLabels, ...overrides };
}
