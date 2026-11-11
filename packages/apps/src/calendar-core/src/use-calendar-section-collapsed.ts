import { useCallback, useState } from "react";
import {
  patchCalendarViewPrefs,
  readCalendarViewPrefs,
  type CalendarSectionCollapsedPref,
} from "@/calendar-core/src/calendar-view-prefs";

/** A Calendar sidebar section's fold state, remembered on this device. */
export function useCalendarSectionCollapsed(pref: CalendarSectionCollapsedPref) {
  const [collapsed, setCollapsed] = useState(() => readCalendarViewPrefs()?.[pref] === true);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      patchCalendarViewPrefs({ [pref]: !current });
      return !current;
    });
  }, [pref]);
  return { collapsed, toggleCollapsed };
}
