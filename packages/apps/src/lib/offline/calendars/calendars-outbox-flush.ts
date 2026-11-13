import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type {
  CalendarDraft,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarPatch,
} from "@/lib/models/calendar-types";
import {
  createCalendarEventLive,
  createCalendarLive,
  deleteCalendarEventLive,
  deleteCalendarLive,
  patchCalendarEventLive,
  patchCalendarLive,
} from "@/lib/api/wgw/calendar";
import {
  CalendarSchedulingGoneError,
  dismissCalendarSchedulingNotification,
  respondCalendarSchedulingNotification,
  type CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import { JmapSetItemError } from "@/lib/jmap-client";
import { calendarBootstrapWindow } from "@/lib/calendar-load-window";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  runOutboxFlush,
  type OutboxFlushContext,
  type OutboxSendOutcome,
} from "@/lib/offline/core/outbox-flush";
import { getOutboxMutation, settleSentOutboxMutation } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { CALENDARS_DOMAIN, calendarsEventsTable } from "@/lib/offline/calendars/calendars-schema";
import {
  markOutboxError,
  readCalendarBootstrapFromCache,
  removeCalendarEventFromCache,
  removeOutboxMutation,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars/calendars-offline-store";

export type CalendarOutboxFlushResult = {
  /** Event ids whose queued write was rejected by the server (deleted/changed remotely). */
  conflicts: string[];
  /** Inbox notification ids whose queued RSVP/dismiss failed because the invite is gone. */
  schedulingConflicts: string[];
  bootstrap: CalendarAppBootstrap | null;
};

/**
 * The envelope flush runs without ifInState (matching the shipped jmap
 * adapter): last write wins. A rejected set item — typically `notFound` after
 * a remote delete — is the conflict signal surfaced to the queue.
 */
function isSetConflict(error: unknown): boolean {
  return (
    error instanceof JmapSetItemError &&
    (error.setError.type === "notFound" || error.setError.type === "stateMismatch")
  );
}

function isSchedulingOutboxOp(op: string): boolean {
  return op === "respond-scheduling" || op === "dismiss-scheduling";
}

function isOutboxConflict(error: unknown, op: string): boolean {
  if (isSetConflict(error)) return true;
  return isSchedulingOutboxOp(op) && error instanceof CalendarSchedulingGoneError;
}

function outboxConflictId(op: string, payload: Record<string, unknown>): string {
  if (isSchedulingOutboxOp(op)) {
    return String(payload.notificationId ?? "");
  }
  return String(payload.eventId ?? "");
}

/** Whole-cache rewrites keep a period merged between their read and write (#1675). */
function cacheWindow() {
  return { window: calendarBootstrapWindow() };
}

function isCreateRow(row: OfflineOutboxRow): boolean {
  return row.op === "create" || row.op === "calendarCreate";
}

/** The row's payload, or an empty one when it cannot be read. */
function payloadOf(row: OfflineOutboxRow): Record<string, unknown> {
  try {
    return JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Writes the calendars list `edit` returns over the latest cached bootstrap. */
async function rewriteCachedCalendars(
  username: string,
  edit: (data: CalendarAppBootstrap["data"]) => Partial<CalendarAppBootstrap["data"]>,
): Promise<void> {
  const latest = await readCalendarBootstrapFromCache(username);
  if (!latest) return;
  await writeCalendarBootstrapToCache(
    username,
    { ...latest, data: { ...latest.data, ...edit(latest.data) } },
    cacheWindow(),
  );
}

type CalendarsFlushState = {
  username: string;
  tempToServerId: Map<string, string>;
};

/** Sends one Calendars row; resolving plainly lets the runner remove it. */
async function sendCalendarsRow(
  state: CalendarsFlushState,
  payload: Record<string, unknown>,
  row: OfflineOutboxRow,
  context: OutboxFlushContext,
): Promise<OutboxSendOutcome> {
  const { username, tempToServerId } = state;
  const resolveEventId = (eventId: string) => tempToServerId.get(eventId) ?? eventId;
  if (row.op === "create") {
    const draft = payload.draft as CalendarEventDraft;
    const tempId = String(payload.tempEventId ?? "");
    const event = await createCalendarEventLive(draft);
    if (event.id && !(await getOutboxMutation(username, row.id))) {
      // Undone while it was sent (`discardUnsentCalendarEvent`): take it back.
      await deleteCalendarEventLive(event.id);
      return "handled";
    }
    if (tempId) {
      await removeCalendarEventFromCache(username, tempId);
      if (event.id) tempToServerId.set(tempId, event.id);
    }
    await upsertCalendarEventInCache(username, event, false);
  } else if (row.op === "update") {
    const eventId = resolveEventId(String(payload.eventId ?? ""));
    const patch = payload.patch as CalendarEventPatch;
    const event = await patchCalendarEventLive(eventId, patch);
    // A patch merged in while this one was sent stays queued.
    const settlement = await settleSentOutboxMutation(username, row, {
      cacheTables: (db) => [calendarsEventsTable(db)],
      onRemoved: () => upsertCalendarEventInCache(username, event, false),
    });
    context.resend(settlement);
    return "handled";
  } else if (row.op === "delete") {
    const eventId = resolveEventId(String(payload.eventId ?? ""));
    await deleteCalendarEventLive(eventId);
    await removeCalendarEventFromCache(username, eventId);
  } else if (row.op === "calendarCreate") {
    const draft = payload.draft as CalendarDraft;
    const tempId = String(payload.tempCalendarId ?? "");
    const created = await createCalendarLive(draft);
    await rewriteCachedCalendars(username, (data) => ({
      calendars: [...data.calendars.filter((calendar) => calendar.id !== tempId), created],
    }));
  } else if (row.op === "calendarUpdate") {
    const calendarId = String(payload.calendarId ?? "");
    const patch = payload.patch as CalendarPatch;
    const updated = await patchCalendarLive(calendarId, patch);
    await rewriteCachedCalendars(username, (data) => ({
      calendars: data.calendars.map((calendar) =>
        calendar.id === calendarId ? updated : calendar,
      ),
    }));
  } else if (row.op === "calendarDelete") {
    const calendarId = String(payload.calendarId ?? "");
    await deleteCalendarLive(calendarId);
    await rewriteCachedCalendars(username, (data) => ({
      calendars: data.calendars.filter((calendar) => calendar.id !== calendarId),
      events: data.events.filter((event) => Object.keys(event.calendarIds ?? {})[0] !== calendarId),
    }));
  } else if (row.op === "respond-scheduling") {
    await respondCalendarSchedulingNotification(
      String(payload.notificationId ?? ""),
      payload.participationStatus as CalendarSchedulingRespondStatus,
      {
        ...(typeof payload.calendarId === "string" ? { calendarId: payload.calendarId } : {}),
        ...(typeof payload.recurrenceId === "string" ? { recurrenceId: payload.recurrenceId } : {}),
        ...(payload.scope === "this" || payload.scope === "future" ? { scope: payload.scope } : {}),
      },
    );
  } else if (row.op === "dismiss-scheduling") {
    await dismissCalendarSchedulingNotification(String(payload.notificationId ?? ""));
  }
}

export async function flushCalendarsOutbox(username: string): Promise<CalendarOutboxFlushResult> {
  const cached = await readCalendarBootstrapFromCache(username);
  if (!cached) {
    return { conflicts: [], schedulingConflicts: [], bootstrap: null };
  }

  const conflicts: string[] = [];
  const schedulingConflicts: string[] = [];
  const state: CalendarsFlushState = { username, tempToServerId: new Map() };

  await runOutboxFlush<Record<string, unknown>>(username, {
    domain: CALENDARS_DOMAIN,
    // Creates first so temp→server remaps exist even when createdAt ties invert FIFO.
    order: (rows) => [...rows.filter(isCreateRow), ...rows.filter((row) => !isCreateRow(row))],
    parse: (row) => JSON.parse(row.payload) as Record<string, unknown>,
    send: (payload, row, context) => sendCalendarsRow(state, payload, row, context),
    onFailure: async ({ row, error }) => {
      if (!isOutboxConflict(error, row.op)) return false;
      const conflictId = outboxConflictId(row.op, payloadOf(row));
      if (isSchedulingOutboxOp(row.op)) {
        if (conflictId) schedulingConflicts.push(conflictId);
        await removeOutboxMutation(username, row.id);
        return true;
      }
      if (conflictId) conflicts.push(conflictId);
      const notFound = error instanceof JmapSetItemError && error.setError.type === "notFound";
      await markOutboxError(
        username,
        row.id,
        "conflict",
        notFound ? httpStatusFromFlushError(error) : undefined,
      );
      return true;
    },
  });

  const bootstrap = await readCalendarBootstrapFromCache(username);
  return { conflicts, schedulingConflicts, bootstrap };
}
