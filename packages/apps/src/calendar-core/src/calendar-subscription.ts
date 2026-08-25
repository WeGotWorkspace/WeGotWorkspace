import { canManageCalendarSharing } from "@/calendar-core/src/calendar-collection-write";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

export function isSubscribedCalendar(calendar: Pick<CalendarInfo, "subscriptionId">): boolean {
  return Boolean(calendar.subscriptionId);
}

/** Administrators only — not subscriptions or sharees. Group members with mayShare can publish. */
export function canPublishCalendar(
  calendar: Pick<CalendarInfo, "subscriptionId" | "scope" | "mayShare">,
): boolean {
  return !isSubscribedCalendar(calendar) && canManageCalendarSharing(calendar);
}

export function writableCalendarId(
  calendars: readonly CalendarInfo[],
  preferred?: string,
): string | undefined {
  const writable = calendars.filter((calendar) => calendar.mayWrite !== false);
  if (preferred && writable.some((calendar) => calendar.id === preferred)) return preferred;
  return (writable.find((calendar) => calendar.isDefault) ?? writable[0])?.id;
}

/** Accept http(s) and webcal(s); do not fetch. */
export function isLikelyCalendarFeedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const normalized = trimmed.replace(/^webcals?:/i, "https:");
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Friendly default name from a feed URL. Does not fetch the remote ICS. */
export function inferCalendarNameFromUrl(value: string): string {
  if (!isLikelyCalendarFeedUrl(value)) return "";
  try {
    const normalized = value.trim().replace(/^webcals?:/i, "https:");
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last) {
      const stripped = last.replace(/\.ics$/i, "").replace(/\+/g, " ");
      let decoded = stripped;
      try {
        decoded = decodeURIComponent(stripped);
      } catch {
        decoded = stripped;
      }
      const human = decoded.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      if (human && human.toLowerCase() !== "ical") {
        return human.replace(/\b\w/g, (char) => char.toUpperCase());
      }
    }
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
