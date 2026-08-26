import { useCallback, useEffect, useState } from "react";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import {
  persistHiddenCalendarIds,
  readCalendarViewPrefs,
  resolveHiddenCalendarIds,
} from "@/calendar-core/src/calendar-view-prefs";

function sameHiddenIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...right].every((id) => left.has(id));
}

/** Device-local hidden-calendar set. Persist lives here so the controller stays an orchestrator. */
export function useCalendarHiddenIds(calendars: ReadonlyArray<CalendarInfo>) {
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<ReadonlySet<string>>(
    () => new Set(resolveHiddenCalendarIds(calendars, readCalendarViewPrefs()?.hiddenCalendarIds)),
  );

  useEffect(() => {
    persistHiddenCalendarIds(hiddenCalendarIds);
  }, [hiddenCalendarIds]);

  const pruneHiddenCalendarIds = useCallback((knownIds: ReadonlySet<string>) => {
    setHiddenCalendarIds((current) => {
      const next = new Set([...current].filter((id) => knownIds.has(id)));
      return sameHiddenIds(current, next) ? current : next;
    });
  }, []);

  return { hiddenCalendarIds, setHiddenCalendarIds, pruneHiddenCalendarIds };
}
