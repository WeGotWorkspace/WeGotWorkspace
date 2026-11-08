import { Circle, CircleDot } from "lucide-react";
import {
  periodInstants,
  type InviteeAvailability,
  type TeamAvailabilityPeriod,
} from "@/calendar-core/src/calendar-invitee-availability";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarDisplayPrefs } from "@/calendar-core/src/use-calendar-display-prefs";
import { Tag } from "@/tag/src/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

export type CalendarInviteeAvailabilityTagProps = {
  availability: InviteeAvailability;
  labels: CalendarUILabels;
};

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

/** Free/Busy tag beside an invitee's RSVP chip. "Busy" lists the overlapping times. */
export function CalendarInviteeAvailabilityTag({
  availability,
  labels,
}: CalendarInviteeAvailabilityTagProps) {
  const { locale, timeZone } = useCalendarDisplayPrefs();
  if (availability.status === "free") {
    return (
      <Tag
        label={labels.eventAttendeesAvailabilityFree}
        icon={<Circle aria-hidden />}
        className="calendar-invitee-availability-tag calendar-invitee-availability-tag--free"
      />
    );
  }

  const rows = availability.overlaps.map((period) =>
    formatAvailabilityOverlap(period, { labels, locale, timeZone }),
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="calendar-invitee-availability-tag__trigger"
          tabIndex={0}
          aria-label={`${labels.eventAttendeesAvailabilityBusy}: ${rows.join("; ")}`}
        >
          <Tag
            label={labels.eventAttendeesAvailabilityBusy}
            icon={<CircleDot aria-hidden />}
            className="calendar-invitee-availability-tag calendar-invitee-availability-tag--busy"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent className="calendar-invitee-availability-tag__tooltip">
        <p className="calendar-invitee-availability-tag__tooltip-title">
          {labels.eventAttendeesAvailabilityBusyWith}
        </p>
        <ul>
          {rows.map((row, index) => (
            <li key={`${index}:${row}`}>{row}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
