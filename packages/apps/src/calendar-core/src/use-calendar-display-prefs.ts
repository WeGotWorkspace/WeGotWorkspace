import { useEffect, useMemo, useState } from "react";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import {
  CALENDAR_DISPLAY_PREFS_STORAGE_KEY,
  readCalendarDisplayPrefs,
  resolveCalendarWeekStart,
  type CalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";
import { defaultTimedEventTimeZone } from "@/calendar-core/src/calendar-timezones";
import { subscribeSettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

export type CalendarDisplayResolved = {
  locale: string;
  timeZone: string;
  timezone: string;
  weekStart: number;
  inviteCalendarId?: string;
};

export function resolveCalendarDisplay(
  prefs: CalendarDisplayPrefs | null | undefined,
): CalendarDisplayResolved {
  const stored = prefs ?? {};
  const locale = resolveLocale(undefined);
  const weekStart = resolveCalendarWeekStart(stored, locale);
  const timeZone = defaultTimedEventTimeZone(stored.timeZone);
  const inviteCalendarId = stored.inviteCalendarId?.trim();
  return {
    locale,
    timeZone,
    timezone: timeZone,
    weekStart,
    ...(inviteCalendarId ? { inviteCalendarId } : {}),
  };
}

export function useCalendarDisplayPrefs(): CalendarDisplayResolved {
  const [prefs, setPrefs] = useState<CalendarDisplayPrefs>(() => readCalendarDisplayPrefs());

  useEffect(() => {
    const refresh = () => setPrefs(readCalendarDisplayPrefs());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CALENDAR_DISPLAY_PREFS_STORAGE_KEY) return;
      refresh();
    };
    window.addEventListener("storage", onStorage);
    const stop = subscribeSettingsSliceSaved((event) => {
      if (event.panelId !== "calendar") return;
      refresh();
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      stop();
    };
  }, []);

  return useMemo(() => resolveCalendarDisplay(prefs), [prefs]);
}
