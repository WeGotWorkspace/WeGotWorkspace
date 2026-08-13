import { Temporal } from "@js-temporal/polyfill";
import { wgwApiBaseUrl, wgwFetch, wgwFetchPrincipal } from "@/lib/api/wgw/http";
import {
  JmapCalendarsClient,
  JmapClient,
  type JmapCalendar,
  type JmapCalendarEvent,
} from "@/lib/jmap-client";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type {
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarInfo,
} from "@/calendar-core/src/calendar-types";
import { draftToJmapEvent, patchToJmapPartial } from "@/calendar-core/src/calendar-wire";

/**
 * Calendar transport: the vendored jmap-client over the JMAP envelope
 * (`/api/v1/jmap`), with auth/refresh delegated to wgwFetch. The bootstrap
 * fetches a fixed window around today; incremental `/changes`-based polling is
 * a documented follow-up (the envelope supports it — see
 * packages/api/docs/calendars/jmap-envelope.md).
 */

/** Cached-events window relative to today. */
const WINDOW_MONTHS_BACK = 12;
const WINDOW_MONTHS_AHEAD = 24;

/**
 * JmapClient fetches sessionUrl and the session's absolute apiUrl verbatim;
 * this bridge routes both through wgwFetch (bearer + refresh) by reducing the
 * URL back to an API-relative path.
 */
function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

let cachedClient: JmapClient | null = null;

function jmapClient(): JmapClient {
  if (!cachedClient) {
    cachedClient = new JmapClient({
      sessionUrl: "/jmap/session",
      fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
    });
  }
  return cachedClient;
}

/** Test-only: drop the memoized client (and its session). */
export function resetCalendarJmapClientForTests(): void {
  cachedClient = null;
}

async function connectedCalendars(): Promise<{
  calendars: JmapCalendarsClient;
  accountId: string;
}> {
  const client = jmapClient();
  if (!client.isConnected) {
    await client.connect();
  }
  return { calendars: new JmapCalendarsClient(client), accountId: client.primaryAccountId() };
}

function toCalendarInfo(calendar: JmapCalendar): CalendarInfo {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color ?? "#6366F1",
    ...(calendar.isVisible === false ? { isVisible: false } : {}),
    ...(calendar.isDefault ? { isDefault: true } : {}),
    mayWrite: calendar.myRights ? calendar.myRights.mayWriteAll === true : true,
  };
}

export function calendarBootstrapWindow(today = Temporal.Now.plainDateISO()): {
  utcStart: Date;
  utcEnd: Date;
} {
  const start = today.subtract({ months: WINDOW_MONTHS_BACK }).with({ day: 1 });
  const end = today.add({ months: WINDOW_MONTHS_AHEAD }).with({ day: 1 });
  return {
    utcStart: new Date(`${start.toString()}T00:00:00Z`),
    utcEnd: new Date(`${end.toString()}T00:00:00Z`),
  };
}

export async function fetchCalendarLiveBootstrap(): Promise<CalendarAppBootstrap> {
  const session = await wgwFetchPrincipal();
  const { calendars, accountId } = await connectedCalendars();

  const calendarGet = await calendars.getCalendars(accountId);
  const events = await calendars.getCalendarEventsInRange(accountId, calendarBootstrapWindow());

  return {
    session,
    data: {
      calendars: calendarGet.list.map(toCalendarInfo),
      events: events.list,
    },
  };
}

export async function createCalendarEventLive(
  draft: CalendarEventDraft,
): Promise<JmapCalendarEvent> {
  const { calendars, accountId } = await connectedCalendars();
  const response = await calendars.setCalendarEvents({
    accountId,
    create: { "create-1": draftToJmapEvent(draft) },
  });
  const created = response.created?.["create-1"];
  if (!created?.id) throw new Error("CalendarEvent/set returned no created id");
  const get = await calendars.getCalendarEvents(accountId, [created.id]);
  const event = get.list[0];
  if (!event) throw new Error("Created event could not be fetched");
  return event;
}

export async function patchCalendarEventLive(
  eventId: string,
  patch: CalendarEventPatch,
): Promise<JmapCalendarEvent> {
  const { calendars, accountId } = await connectedCalendars();
  await calendars.setCalendarEvents({
    accountId,
    update: { [eventId]: patchToJmapPartial(patch) },
  });
  const get = await calendars.getCalendarEvents(accountId, [eventId]);
  const event = get.list[0];
  if (!event) throw new Error("Updated event could not be fetched");
  return event;
}

export async function deleteCalendarEventLive(eventId: string): Promise<void> {
  const { calendars, accountId } = await connectedCalendars();
  await calendars.setCalendarEvents({ accountId, destroy: [eventId] });
}
