import { Temporal } from "@js-temporal/polyfill";
import { parseAvailabilityOverlayKey } from "@/calendar-core/src/calendar-availability-overlay";
import { isInstantOrOffset, localToPlainDateTime } from "@/lib/jmap-client/mapping/datetime";
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
 * The period's time in the viewer's zone, like the grid shows it: zoned and
 * `…Z` times convert, floating times keep their wall clock, all-day periods
 * list their dates.
 */
export function formatAvailabilityPeriodWhen(
  period: JmapBusyPeriod,
  locale: string,
  viewerTimeZone?: string,
): string {
  const duration = Temporal.Duration.from(period.duration);
  if (period.showWithoutTime) {
    const first = Temporal.PlainDate.from(period.start.slice(0, 10));
    const last = first.add(duration).subtract({ days: 1 });
    const format = new Intl.DateTimeFormat(locale, { ...DAY_FORMAT, timeZone: "UTC" });
    return Temporal.PlainDate.compare(last, first) <= 0
      ? format.format(noonUtc(first))
      : format.formatRange(noonUtc(first), noonUtc(last));
  }
  const zone = viewerTimeZone || Temporal.Now.timeZoneId();
  const raw = period.start.trim();
  const start = isInstantOrOffset(raw)
    ? Temporal.Instant.from(raw).toZonedDateTimeISO(zone)
    : localToPlainDateTime(raw).toZonedDateTime(period.timeZone ?? zone);
  const end = start.add(duration);
  const format = new Intl.DateTimeFormat(locale, { ...TIME_FORMAT, timeZone: zone });
  return format.formatRange(new Date(start.epochMilliseconds), new Date(end.epochMilliseconds));
}
