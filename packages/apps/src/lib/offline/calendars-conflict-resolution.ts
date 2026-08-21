import { getCalendarsSyncRunner } from "@/lib/offline/calendars-hybrid-operations";
import {
  calendarsOutboxEventId,
  listOutboxMutations,
  removeCalendarEventFromCache,
} from "@/lib/offline/calendars-offline-store";
import { putOutboxMutation, removeOutboxMutation } from "@/lib/offline/core/outbox-store";
import type { CalendarOutboxFlushResult } from "@/lib/offline/calendars-outbox-flush";

async function outboxRowsForEvent(username: string, eventId: string) {
  const rows = await listOutboxMutations(username);
  return rows.filter((row) => calendarsOutboxEventId(row) === eventId);
}

/** "Keep mine": clear the error stamp and re-flush so the local event write wins. */
export async function resolveCalendarsConflictKeepLocal(
  username: string,
  eventId: string,
): Promise<CalendarOutboxFlushResult | undefined> {
  const rows = await outboxRowsForEvent(username, eventId);
  for (const row of rows) {
    await putOutboxMutation(username, {
      ...row,
      ifInState: undefined,
      retries: 0,
      lastError: undefined,
    });
  }
  return getCalendarsSyncRunner(username).flush();
}

/** "Use server": discard queued local changes and drop the optimistic cached event. */
export async function resolveCalendarsConflictUseServer(
  username: string,
  eventId: string,
): Promise<void> {
  const rows = await outboxRowsForEvent(username, eventId);
  for (const row of rows) {
    await removeOutboxMutation(username, row.id);
  }
  await removeCalendarEventFromCache(username, eventId);
}
