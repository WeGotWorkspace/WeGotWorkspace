import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarEventDraft } from "@/calendar-core/src/calendar-types";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import {
  createCalendarEventLive,
  deleteCalendarEventLive,
  fetchCalendarLiveBootstrap,
  patchCalendarEventLive,
} from "@/lib/api/wgw/calendar";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { applyCalendarEventPatch } from "@/lib/offline/calendars/calendars-patch-merge";
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import {
  createTempCalendarEventId,
  enqueueCoalescedCalendarEventUpdate,
  enqueueOutboxMutation,
  readCalendarBootstrapFromCache,
  removeCalendarEventFromCache,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";
import {
  flushCalendarsOutbox,
  type CalendarOutboxFlushResult,
} from "@/lib/offline/calendars-outbox-flush";
import { reportCalendarsSyncConflicts } from "@/lib/offline/calendars-sync-conflicts";
import { readOfflineCalendarsUsername } from "@/lib/offline/offline-session";

function rethrowUnlessOfflineQueue(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<CalendarOutboxFlushResult>();

async function flushCalendarsOutboxAndReport(username: string): Promise<CalendarOutboxFlushResult> {
  const result = await flushCalendarsOutbox(username);
  reportCalendarsSyncConflicts(result.conflicts);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<CalendarOutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () =>
    flushCalendarsOutboxAndReport(username),
  );
}

function optimisticEventFromDraft(tempId: string, draft: CalendarEventDraft): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: tempId,
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

async function queueOfflineCreate(
  username: string,
  draft: CalendarEventDraft,
): Promise<JmapCalendarEvent> {
  const tempId = createTempCalendarEventId();
  const optimistic = optimisticEventFromDraft(tempId, draft);
  await upsertCalendarEventInCache(username, optimistic, true);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: CALENDARS_DOMAIN,
    op: "create",
    payload: JSON.stringify({ creationId: tempId, tempEventId: tempId, draft }),
  });
  return optimistic;
}

async function resolveCachedEvent(
  username: string,
  eventId: string,
): Promise<JmapCalendarEvent | undefined> {
  const cached = await readCalendarBootstrapFromCache(username);
  return cached?.data.events.find((event) => event.id === eventId);
}

export function createHybridCalendarOperations(username: string): CalendarAPIOperations {
  const runner = runnerFor(username);

  return {
    createEvent: async (draft) => {
      if (!readBrowserOnline()) {
        return queueOfflineCreate(username, draft);
      }
      try {
        const event = await createCalendarEventLive(draft);
        await upsertCalendarEventInCache(username, event, false);
        await runner.flush();
        return event;
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        return queueOfflineCreate(username, draft);
      }
    },
    patchEvent: async (eventId, patch) => {
      const existing = await resolveCachedEvent(username, eventId);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Event not found in cache while offline" : "Event not found",
        );
      }
      const queueOffline = async () => {
        const optimistic = applyCalendarEventPatch(existing, patch);
        await upsertCalendarEventInCache(username, optimistic, true);
        await enqueueCoalescedCalendarEventUpdate(username, eventId, patch);
        return optimistic;
      };
      if (!readBrowserOnline()) {
        return queueOffline();
      }
      try {
        const event = await patchCalendarEventLive(eventId, patch);
        await upsertCalendarEventInCache(username, event, false);
        await runner.flush();
        return event;
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        return queueOffline();
      }
    },
    deleteEvent: async (eventId) => {
      const queueOffline = async () => {
        await removeCalendarEventFromCache(username, eventId);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "delete",
          payload: JSON.stringify({ eventId }),
        });
      };
      if (!readBrowserOnline()) {
        await queueOffline();
        return;
      }
      try {
        await deleteCalendarEventLive(eventId);
        await removeCalendarEventFromCache(username, eventId);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        await queueOffline();
      }
    },
  };
}

export async function fetchCalendarHybridBootstrap(): Promise<CalendarAppBootstrap> {
  const bootstrap = await fetchCalendarLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Calendar bootstrap missing username");
  }
  if (readBrowserOnline()) {
    await flushCalendarsOutboxAndReport(username);
  }
  await writeCalendarBootstrapToCache(username, bootstrap);
  return bootstrap;
}

export async function loadCalendarBootstrapHybrid(): Promise<CalendarAppBootstrap> {
  if (!readBrowserOnline()) {
    const username = readOfflineCalendarsUsername();
    if (username) {
      const cached = await readCalendarBootstrapFromCache(username);
      if (cached) return cached;
    }
    throw new Error("No cached calendar available offline");
  }

  return fetchCalendarHybridBootstrap();
}

export function getCalendarsSyncRunner(
  username: string,
): ConnectivitySyncRunner<CalendarOutboxFlushResult> {
  return runnerFor(username);
}
