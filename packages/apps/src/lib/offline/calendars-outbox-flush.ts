import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarEventDraft, CalendarEventPatch } from "@/calendar-core/src/calendar-types";
import {
  createCalendarEventLive,
  deleteCalendarEventLive,
  patchCalendarEventLive,
} from "@/lib/api/wgw/calendar";
import {
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
} from "@/lib/offline/calendars-offline-store";

export type CalendarOutboxFlushResult = {
  /** Event ids whose queued write was rejected by the server (deleted/changed remotely). */
  conflicts: string[];
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

export async function flushCalendarsOutbox(username: string): Promise<CalendarOutboxFlushResult> {
  const cached = await readCalendarBootstrapFromCache(username);
  if (!cached) {
    return { conflicts: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const conflicts: string[] = [];

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
      } else if (row.op === "respond-scheduling") {
        await respondCalendarSchedulingNotification(
          String(payload.notificationId ?? ""),
          payload.participationStatus as CalendarSchedulingRespondStatus,
        );
      } else if (row.op === "dismiss-scheduling") {
        await dismissCalendarSchedulingNotification(String(payload.notificationId ?? ""));
      }
      await removeOutboxMutation(username, row.id);
    } catch (error) {
      if (isSetConflict(error)) {
        const eventId = String(JSON.parse(row.payload).eventId ?? "");
        if (eventId) conflicts.push(eventId);
        await markOutboxError(username, row.id, "conflict");
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
  return { conflicts, bootstrap };
}
