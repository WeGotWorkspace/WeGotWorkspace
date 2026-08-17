import type { JmapCalendarEvent, JSCalendarRecurrenceRule } from "@/lib/jmap-client";
import type { CalendarEventDraft, CalendarEventPatch } from "@/calendar-core/src/calendar-types";

/** Pure JSCalendar wire shaping shared by the jmap transport and the offline layer. */

export function draftToJmapEvent(draft: CalendarEventDraft): Omit<JmapCalendarEvent, "id"> {
  return {
    "@type": "Event",
    uid: `urn:uuid:${crypto.randomUUID()}`,
    calendarIds: { [draft.calendarId]: true },
    title: draft.title,
    start: draft.start,
    duration: draft.duration,
    ...(draft.timeZone ? { timeZone: draft.timeZone } : {}),
    ...(draft.allDay ? { showWithoutTime: true } : {}),
    ...(draft.location
      ? { locations: { primary: { "@type": "Location", name: draft.location } } }
      : {}),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.freeBusyStatus ? { freeBusyStatus: draft.freeBusyStatus } : {}),
    ...(draft.alerts && Object.keys(draft.alerts).length ? { alerts: draft.alerts } : {}),
    ...(draft.recurrenceRules?.length ? { recurrenceRules: draft.recurrenceRules } : {}),
    ...(draft.recurrenceOverrides && Object.keys(draft.recurrenceOverrides).length
      ? { recurrenceOverrides: draft.recurrenceOverrides }
      : {}),
  } as Omit<JmapCalendarEvent, "id">;
}

export function patchToJmapPartial(patch: CalendarEventPatch): Partial<JmapCalendarEvent> {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.start !== undefined ? { start: patch.start } : {}),
    ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
    ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
    ...(patch.allDay !== undefined ? { showWithoutTime: patch.allDay } : {}),
    ...(patch.calendarId !== undefined ? { calendarIds: { [patch.calendarId]: true } } : {}),
    ...(patch.location !== undefined
      ? { locations: { primary: { "@type": "Location", name: patch.location } } }
      : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.freeBusyStatus !== undefined ? { freeBusyStatus: patch.freeBusyStatus } : {}),
    ...(patch.alerts !== undefined ? { alerts: patch.alerts } : {}),
    ...(patch.recurrenceRules !== undefined
      ? { recurrenceRules: patch.recurrenceRules as JSCalendarRecurrenceRule[] | null }
      : {}),
    ...(patch.recurrenceOverrides !== undefined
      ? { recurrenceOverrides: patch.recurrenceOverrides }
      : {}),
  } as Partial<JmapCalendarEvent>;
}
