import type { Calendar, CalendarRights, CalendarsMap } from "@/lib/calendar-engine";
import type { JmapCalendar, JmapCalendarRights } from "../calendars/types.js";
import type { JmapId } from "../core/types.js";

function mapRights(rights: JmapCalendarRights | undefined): CalendarRights | undefined {
  if (!rights) return undefined;
  return {
    mayReadFreeBusy: rights.mayReadFreeBusy,
    mayReadItems: rights.mayReadItems,
    mayWriteAll: rights.mayWriteAll,
    mayWriteOwn: rights.mayWriteOwn,
    mayUpdatePrivate: rights.mayUpdatePrivate,
    mayRSVP: rights.mayRSVP,
    mayShare: rights.mayShare,
    mayDelete: rights.mayDelete,
  };
}

const DEFAULT_CALENDAR_COLOR = "#4285f4";

export function jmapCalendarToInternal(
  calendar: JmapCalendar,
  options: { accountId: JmapId; apiUrl?: string },
): Calendar {
  return {
    accountId: options.accountId,
    url: options.apiUrl ? `${options.apiUrl}#${calendar.id}` : calendar.id,
    displayName: calendar.name,
    color: calendar.color ?? DEFAULT_CALENDAR_COLOR,
    ...(calendar.isVisible !== undefined ? { isVisible: calendar.isVisible } : {}),
    ...(calendar.sortOrder !== undefined ? { sortOrder: calendar.sortOrder } : {}),
    ...(calendar.isDefault !== undefined ? { isDefault: calendar.isDefault } : {}),
    ...(mapRights(calendar.myRights) ? { myRights: mapRights(calendar.myRights) } : {}),
  };
}

export function jmapCalendarsToMap(
  calendars: JmapCalendar[],
  options: { accountId: JmapId; apiUrl?: string },
): CalendarsMap {
  const map: CalendarsMap = new Map();
  for (const calendar of calendars) {
    map.set(calendar.id, jmapCalendarToInternal(calendar, options));
  }
  return map;
}
