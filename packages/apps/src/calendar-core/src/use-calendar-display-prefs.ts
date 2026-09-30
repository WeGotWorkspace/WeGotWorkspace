import { useEffect, useMemo, useState } from "react";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  CALENDAR_VISIBLE_HOURS_DEFAULT,
  isCalendarVisibleHours,
  isCalendarVisibleHoursStart,
  readCalendarDisplayPrefs,
  resolveCalendarWeekStart,
  type CalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";
import { defaultTimedEventTimeZone } from "@/calendar-core/src/calendar-timezones";
import { subscribeSettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

export type CalendarDisplayResolved = {
  locale: string;
  timeZone: string;
  weekStart: number;
  inviteCalendarId?: string;
  visibleHours: number;
  visibleHoursStart?: number;
};

export function resolveCalendarDisplay(
  prefs: CalendarDisplayPrefs | null | undefined,
): CalendarDisplayResolved {
  const stored = prefs ?? {};
  const locale = resolveLocale(undefined);
  const weekStart = resolveCalendarWeekStart(stored, locale);
  const timeZone = defaultTimedEventTimeZone(stored.timeZone);
  const inviteCalendarId = stored.inviteCalendarId?.trim();
  const visibleHours = isCalendarVisibleHours(stored.visibleHours)
    ? stored.visibleHours
    : CALENDAR_VISIBLE_HOURS_DEFAULT;
  const visibleHoursStart =
    visibleHours < 24 && isCalendarVisibleHoursStart(stored.visibleHoursStart)
      ? stored.visibleHoursStart
      : undefined;
  return {
    locale,
    timeZone,
    weekStart,
    ...(inviteCalendarId ? { inviteCalendarId } : {}),
    visibleHours,
    ...(visibleHoursStart != null ? { visibleHoursStart } : {}),
  };
}

export function useCalendarDisplayPrefs(): CalendarDisplayResolved {
  const [prefs, setPrefs] = useState<CalendarDisplayPrefs>(() => readCalendarDisplayPrefs());

  useEffect(() => {
    const refresh = () => setPrefs(readCalendarDisplayPrefs());
    return subscribeSettingsSliceSaved((event) => {
      if (event.panelId !== "calendar") return;
      refresh();
    });
  }, []);

  return useMemo(() => resolveCalendarDisplay(prefs), [prefs]);
}
