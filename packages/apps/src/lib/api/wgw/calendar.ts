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
  CalendarDraft,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarInfo,
  CalendarPatch,
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

/**
 * Fresh authenticated client. The JmapEventsAdapter needs its OWN client:
 * JmapClient tracks per-type sync states, and sharing one instance with the
 * set transport would advance the state past dialog writes — the adapter's
 * next /changes would then see an empty delta and miss them.
 */
export function createCalendarJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}

/** Shared client for the set/bootstrap transport (session cached per page). */
export function calendarJmapClient(): JmapClient {
  if (!cachedClient) {
    cachedClient = createCalendarJmapClient();
  }
  return cachedClient;
}

/** Test-only: drop the memoized client (and its session). */
export function resetCalendarJmapClientForTests(): void {
  cachedClient = null;
}

async function connectedCalendars(client: JmapClient = calendarJmapClient()): Promise<{
  calendars: JmapCalendarsClient;
  accountId: string;
}> {
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
    sortOrder: typeof calendar.sortOrder === "number" ? calendar.sortOrder : 0,
    ...(calendar.isVisible === false ? { isVisible: false } : {}),
    ...(calendar.isDefault ? { isDefault: true } : {}),
    mayWrite: calendar.myRights ? calendar.myRights.mayWriteAll === true : true,
    mayDelete: calendar.myRights ? calendar.myRights.mayDelete === true : true,
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

/** Bootstrap against any client — the mock api source reuses this with a MockJmapServer client. */
export async function fetchCalendarBootstrapForClient(
  client: JmapClient,
  session: CalendarAppBootstrap["session"],
): Promise<CalendarAppBootstrap> {
  const { calendars, accountId } = await connectedCalendars(client);

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

export async function fetchCalendarLiveBootstrap(): Promise<CalendarAppBootstrap> {
  return fetchCalendarBootstrapForClient(calendarJmapClient(), await wgwFetchPrincipal());
}

export async function createCalendarEventLive(
  draft: CalendarEventDraft,
  client?: JmapClient,
): Promise<JmapCalendarEvent> {
  const { calendars, accountId } = await connectedCalendars(client);
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
  client?: JmapClient,
): Promise<JmapCalendarEvent> {
  const { calendars, accountId } = await connectedCalendars(client);
  await calendars.setCalendarEvents({
    accountId,
    update: { [eventId]: patchToJmapPartial(patch) },
  });
  const get = await calendars.getCalendarEvents(accountId, [eventId]);
  const event = get.list[0];
  if (!event) throw new Error("Updated event could not be fetched");
  return event;
}

export async function deleteCalendarEventLive(eventId: string, client?: JmapClient): Promise<void> {
  const { calendars, accountId } = await connectedCalendars(client);
  await calendars.setCalendarEvents({ accountId, destroy: [eventId] });
}

export async function createCalendarLive(
  draft: CalendarDraft,
  client?: JmapClient,
): Promise<CalendarInfo> {
  const { calendars, accountId } = await connectedCalendars(client);
  const response = await calendars.setCalendars({
    accountId,
    create: {
      "create-1": {
        name: draft.name,
        color: draft.color,
      } as JmapCalendar,
    },
  });
  const created = response.created?.["create-1"];
  if (!created?.id) throw new Error("Calendar/set returned no created id");
  const get = await calendars.getCalendars(accountId, [created.id]);
  const calendar = get.list[0];
  if (!calendar) throw new Error("Created calendar could not be fetched");
  return toCalendarInfo(calendar);
}

export async function patchCalendarLive(
  calendarId: string,
  patch: CalendarPatch,
  client?: JmapClient,
): Promise<CalendarInfo> {
  const { calendars, accountId } = await connectedCalendars(client);
  await calendars.setCalendars({
    accountId,
    update: { [calendarId]: patch },
  });
  const get = await calendars.getCalendars(accountId, [calendarId]);
  const calendar = get.list[0];
  if (!calendar) throw new Error("Updated calendar could not be fetched");
  return toCalendarInfo(calendar);
}

export async function deleteCalendarLive(calendarId: string, client?: JmapClient): Promise<void> {
  const { calendars, accountId } = await connectedCalendars(client);
  await calendars.setCalendars({ accountId, destroy: [calendarId] });
}
