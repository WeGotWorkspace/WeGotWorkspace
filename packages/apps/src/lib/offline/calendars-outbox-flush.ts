import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type {
  CalendarDraft,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarPatch,
} from "@/calendar-core/src/calendar-types";
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
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import {
  listOutboxMutations,
  markOutboxError,
  readCalendarBootstrapFromCache,
  removeCalendarEventFromCache,
  removeOutboxMutation,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";

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

export async function flushCalendarsOutbox(username: string): Promise<CalendarOutboxFlushResult> {
  const cached = await readCalendarBootstrapFromCache(username);
  if (!cached) {
    return { conflicts: [], schedulingConflicts: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const conflicts: string[] = [];
  const schedulingConflicts: string[] = [];

  for (const row of rows) {
    if (row.domain !== CALENDARS_DOMAIN) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "create") {
        const draft = payload.draft as CalendarEventDraft;
        const tempId = String(payload.tempEventId ?? "");
        const event = await createCalendarEventLive(draft);
        if (tempId) await removeCalendarEventFromCache(username, tempId);
        await upsertCalendarEventInCache(username, event, false);
      } else if (row.op === "update") {
        const eventId = String(payload.eventId ?? "");
        const patch = payload.patch as CalendarEventPatch;
        const event = await patchCalendarEventLive(eventId, patch);
        await upsertCalendarEventInCache(username, event, false);
      } else if (row.op === "delete") {
        const eventId = String(payload.eventId ?? "");
        await deleteCalendarEventLive(eventId);
        await removeCalendarEventFromCache(username, eventId);
      } else if (row.op === "calendarCreate") {
        const draft = payload.draft as CalendarDraft;
        const tempId = String(payload.tempCalendarId ?? "");
        const created = await createCalendarLive(draft);
        const latest = await readCalendarBootstrapFromCache(username);
        if (latest) {
          await writeCalendarBootstrapToCache(username, {
            ...latest,
            data: {
              ...latest.data,
              calendars: [
                ...latest.data.calendars.filter((calendar) => calendar.id !== tempId),
                created,
              ],
            },
          });
        }
      } else if (row.op === "calendarUpdate") {
        const calendarId = String(payload.calendarId ?? "");
        const patch = payload.patch as CalendarPatch;
        const updated = await patchCalendarLive(calendarId, patch);
        const latest = await readCalendarBootstrapFromCache(username);
        if (latest) {
          await writeCalendarBootstrapToCache(username, {
            ...latest,
            data: {
              ...latest.data,
              calendars: latest.data.calendars.map((calendar) =>
                calendar.id === calendarId ? updated : calendar,
              ),
            },
          });
        }
      } else if (row.op === "calendarDelete") {
        const calendarId = String(payload.calendarId ?? "");
        await deleteCalendarLive(calendarId);
        const latest = await readCalendarBootstrapFromCache(username);
        if (latest) {
          await writeCalendarBootstrapToCache(username, {
            ...latest,
            data: {
              ...latest.data,
              calendars: latest.data.calendars.filter((calendar) => calendar.id !== calendarId),
              events: latest.data.events.filter(
                (event) => Object.keys(event.calendarIds ?? {})[0] !== calendarId,
              ),
            },
          });
        }
      } else if (row.op === "respond-scheduling") {
        await respondCalendarSchedulingNotification(
          String(payload.notificationId ?? ""),
          payload.participationStatus as CalendarSchedulingRespondStatus,
          {
            ...(typeof payload.calendarId === "string" ? { calendarId: payload.calendarId } : {}),
            ...(typeof payload.recurrenceId === "string"
              ? { recurrenceId: payload.recurrenceId }
              : {}),
            ...(payload.scope === "this" || payload.scope === "future"
              ? { scope: payload.scope }
              : {}),
          },
        );
      } else if (row.op === "dismiss-scheduling") {
        await dismissCalendarSchedulingNotification(String(payload.notificationId ?? ""));
      }
      await removeOutboxMutation(username, row.id);
    } catch (error) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (isOutboxConflict(error, row.op)) {
        const conflictId = outboxConflictId(row.op, payload);
        if (isSchedulingOutboxOp(row.op)) {
          if (conflictId) schedulingConflicts.push(conflictId);
          await removeOutboxMutation(username, row.id);
        } else {
          if (conflictId) conflicts.push(conflictId);
          await markOutboxError(username, row.id, "conflict");
        }
        continue;
      }
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const bootstrap = await readCalendarBootstrapFromCache(username);
  return { conflicts, schedulingConflicts, bootstrap };
}
