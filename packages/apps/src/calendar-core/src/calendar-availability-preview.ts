import { Temporal } from "@js-temporal/polyfill";
import {
  availabilityPeriodTiming,
  parseAvailabilityOverlayKey,
} from "@/calendar-core/src/calendar-availability-overlay";
import type { JmapBusyPeriod, JmapTeamMember } from "@/lib/jmap-client/availability/types";

/** What the busy-block popover shows: whose time, and the period as the server sent it. */
export type AvailabilityPreview = {
  key: string;
  username: string;
  /** Display name; the username when the teammate is no longer listed. */
  name: string;
  period: JmapBusyPeriod;
};

/**
 * The popover model for a clicked busy block, or null when the key is not a
 * busy block or the period is gone (the teammate was unticked meanwhile).
 */
export function resolveAvailabilityPreview(
  key: string,
  periodsByUser: ReadonlyMap<string, readonly JmapBusyPeriod[]>,
  members: readonly JmapTeamMember[] | null,
): AvailabilityPreview | null {
  const parsed = parseAvailabilityOverlayKey(key);
  if (!parsed) return null;
  const period = periodsByUser.get(parsed.username)?.[parsed.index];
  if (!period) return null;
  const member = members?.find((entry) => entry.id === parsed.username);
  return { key, username: parsed.username, name: member?.name ?? parsed.username, period };
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DAY_FORMAT,
  hour: "numeric",
  minute: "2-digit",
};

function noonUtc(date: Temporal.PlainDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

/**
 * The period's time in the viewer's zone, read exactly as the grid draws it
 * (`availabilityPeriodTiming`): zoned and `…Z` times convert, floating times
 * and unknown TZIDs keep their wall clock, all-day periods list their dates.
 * Empty when the period doesn't parse; such a period isn't drawn either.
 */
export function formatAvailabilityPeriodWhen(
  period: JmapBusyPeriod,
  locale: string,
  viewerTimeZone?: string,
): string {
  const timing = availabilityPeriodTiming(period);
  if (!timing) return "";
  const { start, duration, allDay, timeZone } = timing;
  if (allDay) {
    const first = start.toPlainDate();
    // The last day touched; `P1D` and `PT24H` both end on the first day.
    const last = start.add(duration).subtract({ nanoseconds: 1 }).toPlainDate();
    const format = new Intl.DateTimeFormat(locale, { ...DAY_FORMAT, timeZone: "UTC" });
    return Temporal.PlainDate.compare(last, first) <= 0
      ? format.format(noonUtc(first))
      : format.formatRange(noonUtc(first), noonUtc(last));
  }
  const zone = viewerTimeZone || Temporal.Now.timeZoneId();
  // Like the grid: the end is the start's wall clock plus the duration, in the
  // period's own zone; only then do both ends convert to the viewer's zone.
  const toViewer = (wall: Temporal.PlainDateTime) =>
    new Date(wall.toZonedDateTime(timeZone ?? zone).epochMilliseconds);
  const format = new Intl.DateTimeFormat(locale, { ...TIME_FORMAT, timeZone: zone });
  return format.formatRange(toViewer(start), toViewer(start.add(duration)));
}
