import { useCallback, useState } from "react";
import {
  calendarViewPrefs,
  type CalendarSectionCollapsedPref,
} from "@/calendar-core/src/calendar-view-prefs";

/** A Calendar sidebar section's fold state, remembered on this device. */
export function useCalendarSectionCollapsed(pref: CalendarSectionCollapsedPref) {
  const [collapsed, setCollapsed] = useState(() => calendarViewPrefs.read()?.[pref] === true);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      calendarViewPrefs.patch({ [pref]: !current });
      return !current;
    });
  }, [pref]);
  return { collapsed, toggleCollapsed };
}
