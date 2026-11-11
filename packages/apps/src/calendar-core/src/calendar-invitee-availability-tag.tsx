import {
  periodInstants,
  type InviteeAvailability,
  type TeamAvailabilityPeriod,
} from "@/calendar-core/src/calendar-invitee-availability";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

/** "10:00 – 11:00 · Design review" or "All day · Vacation", in the viewer's zone. */
export function formatAvailabilityOverlap(
  period: TeamAvailabilityPeriod,
  options: { labels: CalendarUILabels; locale: string; timeZone: string },
): string {
  const { labels, locale, timeZone } = options;
  let when = labels.eventAttendeesAvailabilityAllDay;
  if (!period.showWithoutTime) {
    const { start, end } = periodInstants(period, timeZone);
    const format = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    when = format.formatRange(new Date(start.epochMilliseconds), new Date(end.epochMilliseconds));
  }
  const title = period.title?.trim() || labels.eventAttendeesAvailabilityBusyUntitled;
  return `${when} · ${title}`;
}

/**
 * Tooltip rows for a busy invitee (#1614), or `null` when there is nothing to warn about
 * (free, or no availability for this person). Free invitees keep a plain participant tag.
 */
export function inviteeBusyRows(
  availability: InviteeAvailability | undefined,
  options: { labels: CalendarUILabels; locale: string; timeZone: string },
): string[] | null {
  if (availability?.status !== "busy") return null;
  return availability.overlaps.map((period) => formatAvailabilityOverlap(period, options));
}

/** Busy participant tag tooltip: RSVP status, "Busy at this time", then the overlaps. */
export function CalendarInviteeBusyTooltip({
  rsvpLabel,
  rows,
  labels,
}: {
  rsvpLabel: string;
  rows: string[];
  labels: CalendarUILabels;
}) {
  return (
    <div className="calendar-invitee-busy-tooltip">
      <p>{rsvpLabel}</p>
      <p className="calendar-invitee-busy-tooltip__title">
        {labels.eventAttendeesAvailabilityBusyWith}
      </p>
      <ul>
        {rows.map((row, index) => (
          <li key={`${index}:${row}`}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
