import { useEffect, useMemo, useState } from "react";
import { getLocaleWeekInfo, resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  readCalendarDisplayPrefs,
  resolveCalendarVisibleHours,
  type CalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";
import { defaultTimedEventTimeZone } from "@/calendar-core/src/calendar-timezones";
import { subscribeSettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

export type CalendarDisplayResolved = {
  locale: string;
  timeZone: string;
  timezone?: string;
  weekStart: number;
  visibleHours?: number;
  visibleHoursStart?: number;
};

export function resolveCalendarDisplay(
  prefs: CalendarDisplayPrefs | null | undefined,
): CalendarDisplayResolved {
  const stored = prefs ?? {};
  const locale = resolveLocale(stored.locale);
  const weekStart = getLocaleWeekInfo(locale).firstDay ?? 1;
  const hours = resolveCalendarVisibleHours(stored);
  const storedZone = stored.timeZone?.trim();
  return {
    locale,
    timeZone: defaultTimedEventTimeZone(storedZone),
    timezone: storedZone || undefined,
    weekStart,
    ...hours,
  };
}

export function useCalendarDisplayPrefs(): CalendarDisplayResolved {
  const [prefs, setPrefs] = useState<CalendarDisplayPrefs>(() => readCalendarDisplayPrefs());

  useEffect(() => {
    return subscribeSettingsSliceSaved((event) => {
      if (event.panelId !== "calendar") return;
      setPrefs(readCalendarDisplayPrefs());
    });
  }, []);

  return useMemo(() => resolveCalendarDisplay(prefs), [prefs]);
}
