import { useCallback, useEffect, useState } from "react";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { useConnectivity } from "@/hooks/use-connectivity";
import { listPendingCalendarEventIds } from "@/lib/offline/calendars-offline-store";

const POLL_INTERVAL_MS = 4000;

/**
 * Ids of calendar events with unsynced local changes, for the pending-sync mark.
 */
export function useCalendarPendingSync(
  username: string | null | undefined,
  refreshKey?: number,
): ReadonlySet<string> {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { online } = useConnectivity();

  const refresh = useCallback(async () => {
    if (!username) {
      setPendingIds(new Set<string>());
      return;
    }
    try {
      const ids = await listPendingCalendarEventIds(username);
      setPendingIds(new Set(ids));
    } catch {
      // Keep the last known state if the offline store read fails.
    }
  }, [username]);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const intervalId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh, online, refreshKey]);

  return pendingIds;
}

function eventMatchesPendingId(
  key: string,
  eventId: string | undefined,
  pendingIds: ReadonlySet<string>,
) {
  const masterKey = key.includes("::") ? key.slice(0, key.indexOf("::")) : key;
  return (
    pendingIds.has(key) || pendingIds.has(masterKey) || (eventId ? pendingIds.has(eventId) : false)
  );
}

/** Stamp `pendingOp` onto cached engine events so chips/hooks share the same pending set. */
export function applyPendingSyncToEngineEvents(
  events: CalendarEventsMap,
  pendingIds: ReadonlySet<string>,
): CalendarEventsMap {
  if (pendingIds.size === 0) return events;
  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    next.set(
      key,
      eventMatchesPendingId(key, event.eventId, pendingIds)
        ? { ...event, pendingOp: event.pendingOp ?? "updated" }
        : event,
    );
  }
  return next;
}
