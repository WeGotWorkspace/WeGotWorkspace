import { createMockCalendarIcsOperations } from "@/lib/api/mock/calendar-ics-operations";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import type { JmapCalendarEvent } from "@/lib/jmap-client";

const storyEvent = {
  "@type": "Event",
  id: "story-event",
  uid: "urn:uuid:story-event",
  calendarIds: { default: true },
  title: "Story",
  start: "2033-01-12T09:00:00",
  duration: "PT1H",
  timeZone: "Etc/UTC",
} as JmapCalendarEvent;

/** No-op Calendar API operations for Storybook workspaces (Branding + Apps variants). */
export const calendarStoryOperations: CalendarAPIOperations = {
  createEvent: async () => storyEvent,
  patchEvent: async () => storyEvent,
  deleteEvent: async () => {},
  createCalendar: async (draft) => ({
    id: "story-cal",
    name: draft.name,
    color: draft.color ?? "#6366f1",
  }),
  patchCalendar: async (calendarId, patch) => ({
    id: calendarId,
    name: patch.name ?? "Calendar",
    color: patch.color ?? "#6366f1",
  }),
  deleteCalendar: async () => {},
  ...createMockCalendarIcsOperations(),
};

type CalendarBootstrapLike = {
  session: { user: { email?: string | null } };
  data: {
    events: Parameters<typeof calendarEventsToEngineMap>[0];
    calendars: Parameters<typeof calendarEventsToEngineMap>[1]["calendars"];
  };
};

/**
 * Deterministic read-only surface for stories: same lit views, no adapter
 * (the mock route and live app run the MockJmapServer/JMAP-backed adapter
 * with full drag interactivity).
 */
export function calendarStaticSurfaceFor(data: CalendarBootstrapLike): CalendarSurfaceStore {
  return {
    events: calendarEventsToEngineMap(data.data.events, {
      sessionEmail: data.session.user.email,
      calendars: data.data.calendars,
    }),
    contextValue: undefined,
    syncNow: () => {},
  };
}
