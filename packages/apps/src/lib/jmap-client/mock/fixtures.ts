import type { JmapCalendar, JmapCalendarEvent } from "../calendars/types.js";

export const workCalendar: JmapCalendar = {
  id: "cal-work",
  name: "Work",
  color: "#3366cc",
  sortOrder: 1,
  isSubscribed: true,
  isVisible: true,
  isDefault: true,
  myRights: {
    mayReadFreeBusy: true,
    mayReadItems: true,
    mayWriteAll: true,
    mayWriteOwn: true,
    mayUpdatePrivate: true,
    mayRSVP: true,
    mayShare: false,
    mayDelete: false,
  },
};

export const personalCalendar: JmapCalendar = {
  id: "cal-personal",
  name: "Personal",
  color: "#cc3366",
  sortOrder: 2,
  isSubscribed: true,
  isVisible: false,
};

/** Simple timed event with properties the internal model does not render (kept opaque). */
export const timedEvent: JmapCalendarEvent = {
  "@type": "Event",
  id: "ev-timed",
  uid: "uid-timed-1",
  calendarIds: { "cal-work": true },
  title: "Design review",
  start: "2026-03-10T10:00:00",
  timeZone: "Europe/Amsterdam",
  duration: "PT1H30M",
  color: "#3366cc",
  locations: { loc1: { "@type": "Location", name: "Room 4", description: "4th floor" } },
  // Opaque payload the mapping must round-trip untouched:
  participants: {
    p1: {
      "@type": "Participant",
      name: "Joe Bloggs",
      sendTo: { imip: "mailto:joe@example.com" },
      roles: { attendee: true },
    },
  },
  alerts: {
    a1: {
      "@type": "Alert",
      trigger: { "@type": "OffsetTrigger", offset: "-PT15M" },
    },
  },
  privacy: "public",
};

/** All-day event. */
export const allDayEvent: JmapCalendarEvent = {
  "@type": "Event",
  id: "ev-allday",
  uid: "uid-allday-1",
  calendarIds: { "cal-personal": true },
  title: "Conference",
  start: "2026-03-12T00:00:00",
  duration: "P2D",
  showWithoutTime: true,
};

/** Weekly recurring event with an excluded occurrence and a rescheduled occurrence. */
export const recurringEvent: JmapCalendarEvent = {
  "@type": "Event",
  id: "ev-recurring",
  uid: "uid-recurring-1",
  calendarIds: { "cal-work": true },
  title: "Standup",
  start: "2026-03-02T09:00:00",
  timeZone: "Europe/Amsterdam",
  duration: "PT15M",
  recurrenceRules: [
    {
      "@type": "RecurrenceRule",
      frequency: "weekly",
      byDay: [
        { "@type": "NDay", day: "mo" },
        { "@type": "NDay", day: "we" },
      ],
    },
  ],
  recurrenceOverrides: {
    // Cancelled occurrence:
    "2026-03-09T09:00:00": { excluded: true },
    // Rescheduled + renamed occurrence carrying an unmanaged patch key:
    "2026-03-11T09:00:00": {
      title: "Standup (moved)",
      start: "2026-03-11T11:00:00",
      "alerts/a1/trigger/offset": "-PT5M",
    },
  },
};
