import {
  createCalendarAppBootstrap,
  type CalendarAppBootstrap,
} from "@/lib/api/mock/calendar-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarEventDraft } from "@/calendar-core/src/calendar-types";

export type CalendarApiSource = {
  loadBootstrap: () => Promise<CalendarAppBootstrap>;
  createOperations: (bootstrap?: CalendarAppBootstrap) => CalendarAPIOperations | undefined;
};

function draftToWireEvent(id: string, draft: CalendarEventDraft): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
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
  } as JmapCalendarEvent;
}

function createMockCalendarOperations(
  getBootstrap: () => CalendarAppBootstrap,
  setBootstrap: (next: CalendarAppBootstrap) => void,
): CalendarAPIOperations {
  const updateEvents = (updater: (events: JmapCalendarEvent[]) => JmapCalendarEvent[]) => {
    const current = getBootstrap();
    setBootstrap({
      ...current,
      data: { ...current.data, events: updater(current.data.events) },
    });
  };

  return {
    createEvent: async (draft) => {
      const created = draftToWireEvent(`event-${Date.now()}`, draft);
      updateEvents((events) => [...events, created]);
      return created;
    },
    patchEvent: async (eventId, patch) => {
      let updated: JmapCalendarEvent | null = null;
      updateEvents((events) =>
        events.map((event) => {
          if (event.id !== eventId) return event;
          updated = {
            ...event,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.start !== undefined ? { start: patch.start } : {}),
            ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
            ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
            ...(patch.allDay !== undefined ? { showWithoutTime: patch.allDay } : {}),
            ...(patch.calendarId !== undefined
              ? { calendarIds: { [patch.calendarId]: true as const } }
              : {}),
          };
          return updated;
        }),
      );
      if (!updated) throw new Error("Event not found");
      return updated;
    },
    deleteEvent: async (eventId) => {
      updateEvents((events) => events.filter((event) => event.id !== eventId));
    },
  };
}

/**
 * Live source lands with the offline domain (chunk C): hybrid bootstrap over
 * the vendored jmap-client + Dexie cache, mirroring tasks-api-source.ts.
 */
export function createDefaultCalendarApiSource(): CalendarApiSource {
  let mockBootstrap = createCalendarAppBootstrap();

  const mockSource: CalendarApiSource = {
    loadBootstrap: () => Promise.resolve(mockBootstrap),
    createOperations: () =>
      createMockCalendarOperations(
        () => mockBootstrap,
        (next) => {
          mockBootstrap = next;
        },
      ),
  };

  return createWorkspaceSource<CalendarApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => mockSource,
    // Chunk C replaces this with the hybrid (jmap + Dexie) source.
    createLiveSource: () => mockSource,
  });
}
