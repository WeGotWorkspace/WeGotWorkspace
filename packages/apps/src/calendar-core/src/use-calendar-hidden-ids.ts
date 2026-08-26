import { useEffect, useRef, useState } from "react";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import {
  persistHiddenCalendarIds,
  readCalendarViewPrefs,
  resolveHiddenCalendarIds,
} from "@/calendar-core/src/calendar-view-prefs";

function sameHiddenIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...right].every((id) => left.has(id));
}

function calendarIdsOf(calendars: ReadonlyArray<{ id: string }>): string[] {
  return calendars.map((calendar) => calendar.id);
}

/** Device-local hidden-calendar set. Persist lives here so the controller stays an orchestrator. */
export function useCalendarHiddenIds(calendars: ReadonlyArray<CalendarInfo>) {
  const calendarsRef = useRef(calendars);
  calendarsRef.current = calendars;
  const seenIdsRef = useRef<ReadonlySet<string>>(
    new Set(readCalendarViewPrefs()?.knownCalendarIds ?? calendarIdsOf(calendars)),
  );

  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<ReadonlySet<string>>(() => {
    return new Set(resolveHiddenCalendarIds(calendars, readCalendarViewPrefs()));
  });

  useEffect(() => {
    persistHiddenCalendarIds(hiddenCalendarIds, calendarIdsOf(calendarsRef.current));
  }, [hiddenCalendarIds]);

  useEffect(() => {
    setHiddenCalendarIds((current) => {
      const next = new Set(
        resolveHiddenCalendarIds(calendars, {
          hiddenCalendarIds: [...current],
          knownCalendarIds: [...seenIdsRef.current],
        }),
      );
      return sameHiddenIds(current, next) ? current : next;
    });
    seenIdsRef.current = new Set(calendarIdsOf(calendars));
  }, [calendars]);

  return { hiddenCalendarIds, setHiddenCalendarIds };
}
