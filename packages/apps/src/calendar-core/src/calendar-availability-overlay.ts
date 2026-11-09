import { Temporal } from "@js-temporal/polyfill";
import {
  toIANATimeZone,
  UTC_TIMEZONE,
  type CalendarEvent,
  type CalendarEventsMap,
} from "@/lib/calendar-engine";
import { isInstantOrOffset, localToPlainDateTime } from "@/lib/jmap-client/mapping/datetime";
import type { JmapBusyPeriod } from "@/lib/jmap-client/availability/types";
import {
  avatarColorForUserId,
  USER_AVATAR_COLORS,
  type UserAvatarColor,
} from "@/user-avatar/src/user-avatar-color";

/** Prefix of a teammate's virtual, read-only calendar and of its grid keys. */
export const AVAILABILITY_CALENDAR_PREFIX = "availability:";
export const AVAILABILITY_OVERLAY_KIND = "availability" as const;

/** Same hex as `--user-avatar-*`, so a teammate's blocks match their avatar. */
const AVATAR_HEX: Record<UserAvatarColor, string> = {
  amber: "#f59e0b",
  cyan: "#06b6d4",
  orange: "#f97316",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  lime: "#84cc16",
  teal: "#14b8a6",
  sky: "#0ea5e9",
};

/** `availability:{username}`. Never stored as a calendar, never a default or invite target. */
export function availabilityCalendarId(username: string): string {
  return `${AVAILABILITY_CALENDAR_PREFIX}${username}`;
}

export function isAvailabilityCalendarId(id: string | undefined | null): boolean {
  return Boolean(id?.startsWith(AVAILABILITY_CALENDAR_PREFIX));
}

/** Grid key of one busy period: `availability:{username}#{index}`. */
export function availabilityOverlayKey(username: string, index: number): string {
  return `${availabilityCalendarId(username)}#${index}`;
}

export function parseAvailabilityOverlayKey(
  key: string | undefined | null,
): { username: string; index: number } | null {
  if (!key?.startsWith(AVAILABILITY_CALENDAR_PREFIX)) return null;
  const rest = key.slice(AVAILABILITY_CALENDAR_PREFIX.length);
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { username: rest.slice(0, hash), index };
}

export function isAvailabilityOverlayEvent(
  event: Pick<CalendarEvent, "overlayKind" | "calendarId"> | undefined | null,
): boolean {
  if (!event) return false;
  return (
    event.overlayKind === AVAILABILITY_OVERLAY_KIND || isAvailabilityCalendarId(event.calendarId)
  );
}

/** Each teammate's colour in Team availability, resolved over the whole list. */
export type AvailabilityColors = ReadonlyMap<string, UserAvatarColor>;

/**
 * Distinct colours for the Team availability list. Usernames are walked in
 * sorted order, so list order, filters and ticks never recolour anyone. Each
 * keeps their avatar colour while it is free, else takes the next free colour
 * in palette order. Colours repeat only once all of them are taken. Pass the
 * whole list, ticked or not.
 */
export function resolveAvailabilityColors(
  usernames: Iterable<string>,
): Map<string, UserAvatarColor> {
  const sorted = [...new Set(usernames)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const taken = new Set<UserAvatarColor>();
  const colors = new Map<string, UserAvatarColor>();
  for (const username of sorted) {
    const own = avatarColorForUserId(username);
    let color = own;
    if (taken.size < USER_AVATAR_COLORS.length) {
      const first = USER_AVATAR_COLORS.indexOf(own);
      for (let step = 0; step < USER_AVATAR_COLORS.length; step += 1) {
        const candidate = USER_AVATAR_COLORS[(first + step) % USER_AVATAR_COLORS.length]!;
        if (!taken.has(candidate)) {
          color = candidate;
          break;
        }
      }
    }
    taken.add(color);
    colors.set(username, color);
  }
  return colors;
}

/** A teammate's resolved colour; their avatar colour when not in the list. */
export function availabilityColorToken(
  username: string,
  colors?: AvailabilityColors,
): UserAvatarColor {
  return colors?.get(username) ?? avatarColorForUserId(username);
}

/** The hex of a teammate's resolved colour, for checkboxes and blocks. */
export function availabilityColor(username: string, colors?: AvailabilityColors): string {
  return AVATAR_HEX[availabilityColorToken(username, colors)];
}

/**
 * One read-only grid event for a busy period. Periods keep their own zone,
 * so the views convert them like normal events. All-day periods cover their
 * dates in the viewer's zone, like all-day events.
 */
export function availabilityPeriodEvent(
  username: string,
  index: number,
  period: JmapBusyPeriod,
  busyLabel: string,
  colors?: AvailabilityColors,
): CalendarEvent | null {
  let start: Temporal.PlainDateTime;
  let duration: Temporal.Duration;
  try {
    start = localToPlainDateTime(period.start);
    duration = Temporal.Duration.from(period.duration);
  } catch {
    return null;
  }
  const allDay = period.showWithoutTime === true;
  // A `…Z` start is an instant: pin it to UTC so the views convert it like any zoned event.
  const timeZone = allDay
    ? null
    : period.timeZone
      ? toIANATimeZone(period.timeZone)
      : isInstantOrOffset(period.start.trim())
        ? UTC_TIMEZONE
        : null;
  // Untitled periods read "Busy", so every block has an accessible name.
  const title = period.title?.trim() || busyLabel;
  const location = period.location?.trim() ?? "";
  return {
    overlayKind: AVAILABILITY_OVERLAY_KIND,
    calendarId: availabilityCalendarId(username),
    eventId: availabilityOverlayKey(username, index),
    data: {
      start: allDay ? start.with({ hour: 0, minute: 0, second: 0 }) : start,
      allDay,
      ...(timeZone ? { timeZone } : {}),
      summary: title,
      ...(location ? { location } : {}),
      color: availabilityColor(username, colors),
      duration,
    },
  };
}

/** Grid events for every shown teammate, keyed `availability:{username}#{index}`. */
export function buildAvailabilityOverlayEvents(
  periodsByUser: ReadonlyMap<string, readonly JmapBusyPeriod[]>,
  busyLabel: string,
  colors?: AvailabilityColors,
): CalendarEventsMap {
  const events: CalendarEventsMap = new Map();
  for (const [username, periods] of periodsByUser) {
    periods.forEach((period, index) => {
      const event = availabilityPeriodEvent(username, index, period, busyLabel, colors);
      if (event) events.set(availabilityOverlayKey(username, index), event);
    });
  }
  return events;
}
