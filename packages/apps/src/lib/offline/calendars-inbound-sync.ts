import {
  JmapCalendarsClient,
  JmapMethodError,
  type DateRange,
  type JmapCalendarEvent,
  type JmapClient,
  type JmapId,
} from "@/lib/jmap-client";
import {
  runScopedInbound,
  type ScopedInboundBinding,
  type ScopedInboundResult,
} from "@/lib/offline/core/inbound-sync";
import {
  ingestRemoteCalendarEvent,
  ingestRemoteCalendarEventDestroyed,
} from "@/lib/offline/calendars-jmap-inbound";

const CALENDAR_EVENT_TYPE = "CalendarEvent";

/** Calendar events are pulled for the whole account: one scope. */
const EVENTS_SCOPE = "events";

/** Where the live Calendar tab reads events from. */
export type CalendarEventsSource = {
  client: JmapClient;
  accountId: JmapId;
  /** The window the tab loaded last. A full list re-reads it. */
  range: DateRange | undefined;
};

function isCannotCalculateChanges(error: unknown): boolean {
  return error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges";
}

/**
 * CalendarEvent inbound for the open Calendar tab, on the shared engine (#1565).
 *
 * It behaves as the adapter's own pull did:
 * - The token is the JMAP client's state in memory, which the window load set.
 *   The client stores the state from each `/changes` and `/get` answer, so the
 *   engine does not write it.
 * - Changed events are fetched in one `/get`; an id it does not return is left out.
 * - An expired token re-lists the loaded window and removes nothing.
 * - An event with a pending write is skipped and reported as a conflict.
 *
 * The protections the design note gives Calendar (a stored token, queued
 * outbox rows as pending writes, removal from the window) come one at a time
 * on top of this binding.
 */
function calendarEventsInbound(
  username: string,
  source: CalendarEventsSource,
): ScopedInboundBinding<JmapCalendarEvent, { id: string; scope?: string }> {
  const { client, accountId } = source;
  const calendars = new JmapCalendarsClient(client);
  const fetched = new Map<string, JmapCalendarEvent>();
  return {
    readToken: async () => client.getState(accountId, CALENDAR_EVENT_TYPE) ?? null,
    writeToken: async () => {},
    changes: async (_scope, since) => {
      const changes = await calendars.calendarEventChanges(accountId, since);
      const changedIds = [...changes.created, ...changes.updated];
      if (changedIds.length > 0) {
        const got = await calendars.getCalendarEvents(accountId, changedIds);
        for (const event of got.list) if (event.id) fetched.set(event.id, event);
      }
      return {
        created: changes.created.filter((id) => fetched.has(id)),
        updated: changes.updated.filter((id) => fetched.has(id)),
        destroyed: changes.destroyed,
        newState: changes.newState,
      };
    },
    isCannotCalculateChanges,
    list: async () => {
      if (!source.range) return [];
      const got = await calendars.getCalendarEventsInRange(accountId, source.range);
      return got.list.filter((event) => Boolean(event.id));
    },
    currentState: async () => client.getState(accountId, CALENDAR_EVENT_TYPE) ?? "",
    rowId: (event) => event.id ?? "",
    fetch: async (id) => {
      const event = fetched.get(id);
      if (!event) throw new Error(`CalendarEvent ${id} was not fetched`);
      return event;
    },
    // A full list removes nothing yet: the adapter only re-listed the window.
    readCached: async () => ({ items: [], keep: () => true }),
    createApplier: async () => ({
      ingest: (event) => ingestRemoteCalendarEvent(username, event),
      ingestDestroyed: (id) => ingestRemoteCalendarEventDestroyed(username, id),
      // Every run keeps the client's state: a skipped change of a pending event
      // goes to the conflict dialog, not to the next run.
      blocksToken: new Set<string>(),
    }),
  };
}

/**
 * Pulls CalendarEvent changes since the client's state and applies them to the
 * offline cache. Before the window has loaded there is no state, and nothing runs.
 */
export async function syncCalendarEventChanges(
  username: string,
  source: CalendarEventsSource,
): Promise<ScopedInboundResult> {
  if (!source.client.getState(source.accountId, CALENDAR_EVENT_TYPE)) {
    return { changed: false, usedFullResync: false };
  }
  return runScopedInbound([EVENTS_SCOPE], calendarEventsInbound(username, source));
}
