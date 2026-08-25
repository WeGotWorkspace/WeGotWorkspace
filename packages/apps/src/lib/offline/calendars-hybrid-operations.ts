import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type {
  CalendarAPIOperations,
  CalendarDraft,
  CalendarEventDraft,
  CalendarInfo,
  CalendarPatch,
  CalendarSubscriptionDraft,
} from "@/calendar-core/src/calendar-types";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import {
  createCalendarEventLive,
  createCalendarLive,
  deleteCalendarEventLive,
  deleteCalendarLive,
  fetchCalendarLiveBootstrap,
  importEventsLive,
  patchCalendarEventLive,
  patchCalendarLive,
} from "@/lib/api/wgw/calendar";
import {
  createCalendarSubscriptionLive,
  deleteCalendarSubscriptionLive,
  getCalendarFeedLive,
  getCalendarSubscriptionLive,
  listCalendarSubscriptionsLive,
  publishCalendarFeedLive,
  refreshStaleCalendarSubscriptionsLive,
  unpublishCalendarFeedLive,
} from "@/lib/api/wgw/calendar-ics-webcal";
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
  createTempCalendarId,
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
import {
  reportCalendarsSchedulingConflicts,
  reportCalendarsSyncConflicts,
} from "@/lib/offline/calendars-sync-conflicts";
import { readOfflineCalendarsUsername } from "@/lib/offline/offline-session";

function rethrowUnlessOfflineQueue(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

function requireOnline(action: string): void {
  if (!readBrowserOnline()) {
    throw new Error(`${action} requires a connection`);
  }
}

async function withSubscriptionUrls(
  bootstrap: CalendarAppBootstrap,
): Promise<CalendarAppBootstrap> {
  const list = await listCalendarSubscriptionsLive().catch(() => []);
  if (list.length === 0) return bootstrap;
  const urlById = new Map(list.map((row) => [row.id, row.url]));
  return {
    ...bootstrap,
    data: {
      ...bootstrap.data,
      calendars: bootstrap.data.calendars.map((calendar) => {
        const url = calendar.subscriptionId ? urlById.get(calendar.subscriptionId) : undefined;
        return url ? { ...calendar, subscriptionUrl: url } : calendar;
      }),
    },
  };
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<CalendarOutboxFlushResult>();

async function flushCalendarsOutboxAndReport(username: string): Promise<CalendarOutboxFlushResult> {
  if (!readBrowserOnline()) {
    return { conflicts: [], schedulingConflicts: [], bootstrap: null };
  }
  const result = await flushCalendarsOutbox(username);
  reportCalendarsSyncConflicts(result.conflicts);
  reportCalendarsSchedulingConflicts(result.schedulingConflicts);
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
  const tempId =
    typeof draft.id === "string" && draft.id.startsWith("local-")
      ? draft.id
      : createTempCalendarEventId();
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
        throw new Error("Event not found in cache");
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
    importEvents: async (icsText, opts) => {
      if (!readBrowserOnline()) {
        throw new Error("ICS import requires an internet connection");
      }
      const result = await importEventsLive(icsText, opts);
      for (const event of result.list) {
        await upsertCalendarEventInCache(username, event, false);
      }
      return result;
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
      const queueOffline = async () => {
        const tempId = createTempCalendarId();
        const created: CalendarInfo = {
          id: tempId,
          name: draft.name,
          color: draft.color,
          mayWrite: true,
          mayDelete: true,
          ...(draft.groupSlug
            ? { scope: "group" as const, groupSlug: draft.groupSlug }
            : { scope: "personal" as const }),
        };
        await writeCalendarsToCache(username, (calendars) => [...calendars, created]);
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "calendarCreate",
          payload: JSON.stringify({ creationId: tempId, tempCalendarId: tempId, draft }),
        });
        return created;
      };
      if (!readBrowserOnline()) {
        return queueOffline();
      }
      try {
        const created = await createCalendarLive(draft);
        await writeCalendarsToCache(username, (calendars) => [...calendars, created]);
        await runner.flush();
        return created;
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        return queueOffline();
      }
    },
    patchCalendar: async (calendarId: string, patch: CalendarPatch) => {
      const queueOffline = async () => {
        const cached = await readCalendarBootstrapFromCache(username);
        const existing = cached?.data.calendars.find((calendar) => calendar.id === calendarId);
        if (!existing) {
          throw new Error("Calendar not found in cache while offline");
        }
        const updated = { ...existing, ...patch };
        await writeCalendarsToCache(username, (calendars) =>
          calendars.map((calendar) => (calendar.id === calendarId ? updated : calendar)),
        );
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "calendarUpdate",
          payload: JSON.stringify({ calendarId, patch }),
        });
        return updated;
      };
      if (!readBrowserOnline()) {
        return queueOffline();
      }
      try {
        const updated = await patchCalendarLive(calendarId, patch);
        await writeCalendarsToCache(username, (calendars) =>
          calendars.map((calendar) => (calendar.id === calendarId ? updated : calendar)),
        );
        await runner.flush();
        return updated;
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        return queueOffline();
      }
    },
    subscribeCalendar: async (draft: CalendarSubscriptionDraft) => {
      requireOnline("Subscribe");
      const subscription = await createCalendarSubscriptionLive({
        url: draft.url,
        ...(draft.name?.trim() ? { name: draft.name.trim() } : {}),
        ...(draft.color?.trim() ? { color: draft.color.trim() } : {}),
        ...(draft.groupSlug?.trim() ? { groupSlug: draft.groupSlug.trim() } : {}),
      });
      const groupSlug = draft.groupSlug?.trim() || null;
      const created: CalendarInfo = {
        id: subscription.calendarId,
        name: subscription.name?.trim() || draft.name?.trim() || "Subscribed calendar",
        color: subscription.color?.trim() || draft.color?.trim() || DEFAULT_CALENDAR_COLOR,
        mayWrite: false,
        mayDelete: true,
        subscriptionId: subscription.id,
        subscriptionUrl: subscription.url,
        ...(groupSlug ? { scope: "group" as const, groupSlug } : { scope: "personal" as const }),
      };
      await writeCalendarsToCache(username, (calendars) => [...calendars, created]);
      await runner.flush();
      return created;
    },
    getCalendarSubscription: async (subscriptionId) => {
      requireOnline("Load subscription");
      return getCalendarSubscriptionLive(subscriptionId);
    },
    unsubscribeCalendar: async (subscriptionId) => {
      requireOnline("Unsubscribe");
      const subscription = await getCalendarSubscriptionLive(subscriptionId).catch(() => null);
      await deleteCalendarSubscriptionLive(subscriptionId);
      if (subscription?.calendarId) {
        await writeCalendarsToCache(username, (calendars) =>
          calendars.filter((calendar) => calendar.id !== subscription.calendarId),
        );
      }
      await runner.flush();
    },
    refreshStaleCalendarSubscriptions: async () => {
      if (!readBrowserOnline()) return false;
      return refreshStaleCalendarSubscriptionsLive();
    },
    getCalendarFeed: async (calendarId) => {
      requireOnline("Load calendar feed");
      return getCalendarFeedLive(calendarId);
    },
    publishCalendarFeed: async (calendarId) => {
      requireOnline("Publish");
      return publishCalendarFeedLive(calendarId);
    },
    unpublishCalendarFeed: async (calendarId) => {
      requireOnline("Unpublish");
      await unpublishCalendarFeedLive(calendarId);
    },
    deleteCalendar: async (calendarId: string) => {
      const queueOffline = async () => {
        const cached = await readCalendarBootstrapFromCache(username);
        await writeCalendarsToCache(username, (calendars) =>
          calendars.filter((calendar) => calendar.id !== calendarId),
        );
        for (const event of cached?.data.events ?? []) {
          const eventCalendarId = Object.keys(event.calendarIds ?? {})[0];
          if (eventCalendarId === calendarId) {
            await removeCalendarEventFromCache(username, event.id);
          }
        }
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "calendarDelete",
          payload: JSON.stringify({ calendarId }),
        });
      };
      if (!readBrowserOnline()) {
        await queueOffline();
        return;
      }
      try {
        await deleteCalendarLive(calendarId);
        await writeCalendarsToCache(username, (calendars) =>
          calendars.filter((calendar) => calendar.id !== calendarId),
        );
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error);
        await queueOffline();
      }
    },
    listSchedulingNotifications: () => fetchCalendarSchedulingNotifications(),
    listInvitees: () => fetchCalendarSchedulingInvitees(),
    respondSchedulingNotification: async (notificationId, status, respondOptions) => {
      const queueOffline = async () => {
        await enqueueOutboxMutation(username, {
          id: crypto.randomUUID(),
          domain: CALENDARS_DOMAIN,
          op: "respond-scheduling",
          payload: JSON.stringify({
            notificationId,
            participationStatus: status,
            ...(respondOptions?.calendarId ? { calendarId: respondOptions.calendarId } : {}),
            ...(respondOptions?.recurrenceId ? { recurrenceId: respondOptions.recurrenceId } : {}),
            ...(respondOptions?.scope ? { scope: respondOptions.scope } : {}),
          }),
        });
      };
      if (!readBrowserOnline()) {
        await queueOffline();
        return;
      }
      try {
        await respondCalendarSchedulingNotification(notificationId, status, respondOptions);
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
  let bootstrap = await fetchCalendarLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Calendar bootstrap missing username");
  }
  // Write first so pendingSync rows survive a live snapshot that raced ahead of
  // flush; then drain the outbox and return the merged cache (not the raw live
  // payload, which would revert optimistic patches in the UI).
  await writeCalendarBootstrapToCache(username, bootstrap);
  if (readBrowserOnline()) {
    await flushCalendarsOutboxAndReport(username);
    const refreshed = await refreshStaleCalendarSubscriptionsLive().catch(() => false);
    if (refreshed) {
      bootstrap = await fetchCalendarLiveBootstrap();
      await writeCalendarBootstrapToCache(username, bootstrap);
      await flushCalendarsOutboxAndReport(username);
    }
    const merged = (await readCalendarBootstrapFromCache(username)) ?? bootstrap;
    bootstrap = await withSubscriptionUrls(merged).catch(() => merged);
    await writeCalendarBootstrapToCache(username, bootstrap);
  }
  const cached = await readCalendarBootstrapFromCache(username);
  return cached ?? bootstrap;
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
