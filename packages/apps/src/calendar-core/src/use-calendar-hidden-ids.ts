import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import {
  persistHiddenCalendarIds,
  readCalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";

/** Device-local hidden-calendar set. Persist lives here so the controller stays an orchestrator. */
export function useCalendarHiddenIds(calendars: ReadonlyArray<CalendarInfo>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(calendars, {
    read: () => {
      const prefs = readCalendarViewPrefs();
      if (!prefs) return null;
      return { hiddenIds: prefs.hiddenCalendarIds, knownIds: prefs.knownCalendarIds };
    },
    write: persistHiddenCalendarIds,
  });
  return { hiddenCalendarIds: hiddenIds, setHiddenCalendarIds: setHiddenIds };
}
