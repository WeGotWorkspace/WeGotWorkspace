import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type {
  CalendarAPIOperations,
  CalendarDraft,
  CalendarEventDraft,
  CalendarInfo,
  CalendarPatch,
} from "@/calendar-core/src/calendar-types";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import {
  createCalendarEventLive,
  createCalendarLive,
  deleteCalendarEventLive,
  deleteCalendarLive,
  fetchCalendarLiveBootstrap,
  patchCalendarEventLive,
  patchCalendarLive,
} from "@/lib/api/wgw/calendar";
import {
  dismissCalendarSchedulingNotification,
  fetchCalendarSchedulingInvitees,
  fetchCalendarSchedulingNotifications,
  respondCalendarSchedulingNotification,
} from "@/lib/api/wgw/calendar-scheduling";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { draftToJmapEvent } from "@/calendar-core/src/calendar-wire";
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
  return { ...draftToJmapEvent(draft), id: tempId } as JmapCalendarEvent;
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

async function writeCalendarsToCache(
  username: string,
  mutate: (calendars: CalendarInfo[]) => CalendarInfo[],
): Promise<void> {
  const cached = await readCalendarBootstrapFromCache(username);
  if (!cached) return;
  await writeCalendarBootstrapToCache(username, {
    ...cached,
    data: {
      ...cached.data,
      calendars: mutate(cached.data.calendars),
    },
  });
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
        if (!readBrowserOnline()) {
          throw new Error("Event not found in cache while offline");
        }
        // Not in the cache (e.g. just drag-created through the jmap adapter):
        // patch straight through and add the result to the cache.
        const event = await patchCalendarEventLive(eventId, patch);
        await upsertCalendarEventInCache(username, event, false);
        await runner.flush();
        return event;
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
    createCalendar: async (draft: CalendarDraft) => {
      if (!readBrowserOnline()) {
        throw new Error("Cannot create calendar while offline");
      }
      const created = await createCalendarLive(draft);
      await writeCalendarsToCache(username, (calendars) => [...calendars, created]);
      return created;
    },
    patchCalendar: async (calendarId: string, patch: CalendarPatch) => {
      if (!readBrowserOnline()) {
        throw new Error("Cannot update calendar while offline");
      }
      const updated = await patchCalendarLive(calendarId, patch);
      await writeCalendarsToCache(username, (calendars) =>
        calendars.map((calendar) => (calendar.id === calendarId ? updated : calendar)),
      );
      return updated;
    },
    deleteCalendar: async (calendarId: string) => {
      if (!readBrowserOnline()) {
        throw new Error("Cannot delete calendar while offline");
      }
      await deleteCalendarLive(calendarId);
      await writeCalendarsToCache(username, (calendars) =>
        calendars.filter((calendar) => calendar.id !== calendarId),
      );
    },
    listSchedulingNotifications: () => fetchCalendarSchedulingNotifications(),
    listInvitees: () => fetchCalendarSchedulingInvitees(),
    respondSchedulingNotification: async (notificationId, status, calendarId) => {
      const queueOffline = async () => {
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "respond-scheduling",
          payload: JSON.stringify({
            notificationId,
            participationStatus: status,
            ...(calendarId ? { calendarId } : {}),
          }),
        });
      };
      if (!readBrowserOnline()) {
        await queueOffline();
        return;
      }
      try {
        await respondCalendarSchedulingNotification(notificationId, status, calendarId);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        await queueOffline();
      }
    },
    dismissSchedulingNotification: async (notificationId) => {
      const queueOffline = async () => {
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "dismiss-scheduling",
          payload: JSON.stringify({ notificationId }),
        });
      };
      if (!readBrowserOnline()) {
        await queueOffline();
        return;
      }
      try {
        await dismissCalendarSchedulingNotification(notificationId);
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
