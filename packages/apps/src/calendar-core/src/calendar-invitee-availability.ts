import { Temporal } from "@js-temporal/polyfill";
import type {
  CalendarAvailabilityBusyPeriod,
  CalendarAvailabilityGetResponse,
  CalendarAvailabilityPerson,
  CalendarAvailabilityTeamMember,
  CalendarAvailabilityTeamMemberGetResponse,
} from "@wgw/openapi-types/calendars-types";
import {
  attendeeIdentityKeys,
  normalizeParticipantAddress,
  type CalendarAttendee,
  type CalendarInvitee,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { AVAILABILITY_CAPABILITY, CORE_CAPABILITY, type JmapClient } from "@/lib/jmap-client";

/**
 * Free/Busy next to invited teammates (#1614): one `TeamMember/getAvailability` call for the
 * UTC week(s) around the event, matched to invitees by username. Never claims "Free" on
 * partial data; never written to the client cache (the answer carries `excludeEventId`).
 */

export type TeamAvailabilityPeriod = CalendarAvailabilityBusyPeriod;
export type TeamAvailabilityMember = CalendarAvailabilityTeamMember;

export type TeamAvailabilityRequest = {
  ids: string[];
  utcStart: string;
  utcEnd: string;
  excludeEventId?: string;
};

/** What the invitee tag needs from the server. Swappable for Storybook and tests. */
export type TeamAvailabilitySource = {
  teamMembers: () => Promise<TeamAvailabilityMember[]>;
  availability: (request: TeamAvailabilityRequest) => Promise<CalendarAvailabilityPerson[]>;
};

export type InviteeAvailability =
  { status: "free" } | { status: "busy"; overlaps: TeamAvailabilityPeriod[] };

/** Keyed by the attendee's normalized address (`normalizeParticipantAddress`). */
export type InviteeAvailabilityMap = ReadonlyMap<string, InviteeAvailability>;

const AVAILABILITY_USING = [CORE_CAPABILITY, AVAILABILITY_CAPABILITY];
const MAX_WEEKS_PER_CALL = 54;
/**
 * Floating and all-day periods are bucketed into UTC weeks as if they were UTC. Pad the
 * event by the widest UTC offset before snapping, so those periods near a week edge are
 * still in the answer.
 */
const WEEK_EDGE_PADDING = Temporal.Duration.from({ hours: 14 });

/** `TeamMember/*` over the calendar's JMAP client. No capability → nobody to show. */
export function jmapTeamAvailabilitySource(client: JmapClient): TeamAvailabilitySource {
  const accountId = async (): Promise<string | null> => {
    if (!client.isConnected) await client.connect();
    if (!client.session.capabilities[AVAILABILITY_CAPABILITY]) return null;
    return client.primaryAccountId(AVAILABILITY_CAPABILITY);
  };
  return {
    teamMembers: async () => {
      const id = await accountId();
      if (!id) return [];
      const response = await client.call<CalendarAvailabilityTeamMemberGetResponse>(
        "TeamMember/get",
        { accountId: id, ids: null },
        AVAILABILITY_USING,
      );
      return response.list;
    },
    availability: async (request) => {
      const id = await accountId();
      if (!id) return [];
      const response = await client.call<CalendarAvailabilityGetResponse>(
        "TeamMember/getAvailability",
        { accountId: id, ...request },
        AVAILABILITY_USING,
      );
      return response.list;
    },
  };
}

/** The event's own time as instants, plus the dates it touches in the viewer's zone. */
export type EventAvailabilitySpan = {
  start: Temporal.Instant;
  end: Temporal.Instant;
  firstDate: Temporal.PlainDate;
  lastDate: Temporal.PlainDate;
};

function lastTouchedDate(end: Temporal.Instant, viewerTimeZone: string): Temporal.PlainDate {
  return end.subtract({ nanoseconds: 1 }).toZonedDateTimeISO(viewerTimeZone).toPlainDate();
}

/**
 * Span of the occurrence in the form (the one being edited, or the first of a new series).
 * All-day dates are read in the viewer's zone; a floating time too.
 */
export function eventAvailabilitySpan(
  form: Pick<
    CalendarEventFormValue,
    "allDay" | "startDate" | "startTime" | "endDate" | "endTime" | "timeZone"
  >,
  viewerTimeZone: string,
): EventAvailabilitySpan | null {
  try {
    if (form.allDay) {
      const firstDate = Temporal.PlainDate.from(form.startDate);
      const lastDate = Temporal.PlainDate.from(form.endDate);
      if (Temporal.PlainDate.compare(lastDate, firstDate) < 0) return null;
      return {
        start: firstDate.toZonedDateTime(viewerTimeZone).toInstant(),
        end: lastDate.add({ days: 1 }).toZonedDateTime(viewerTimeZone).toInstant(),
        firstDate,
        lastDate,
      };
    }
    const zone = form.timeZone ?? viewerTimeZone;
    const start = Temporal.PlainDateTime.from(`${form.startDate}T${form.startTime}`)
      .toZonedDateTime(zone)
      .toInstant();
    const end = Temporal.PlainDateTime.from(`${form.endDate}T${form.endTime}`)
      .toZonedDateTime(zone)
      .toInstant();
    if (Temporal.Instant.compare(end, start) <= 0) return null;
    return {
      start,
      end,
      firstDate: start.toZonedDateTimeISO(viewerTimeZone).toPlainDate(),
      lastDate: lastTouchedDate(end, viewerTimeZone),
    };
  } catch {
    return null;
  }
}

function utcMondayOnOrBefore(instant: Temporal.Instant): Temporal.ZonedDateTime {
  const day = instant.toZonedDateTimeISO("UTC").startOfDay();
  return day.subtract({ days: day.dayOfWeek - 1 });
}

/**
 * Whole UTC weeks (Monday 00:00Z) covering the event, so the server answers from the same
 * per-week cache entries as the sidebar. `null` when the span is over the 54-week limit.
 */
export function availabilityWeekRange(
  span: Pick<EventAvailabilitySpan, "start" | "end">,
): { utcStart: string; utcEnd: string } | null {
  const first = utcMondayOnOrBefore(span.start.subtract(WEEK_EDGE_PADDING));
  const last = utcMondayOnOrBefore(span.end.add(WEEK_EDGE_PADDING).subtract({ nanoseconds: 1 }));
  const end = last.add({ weeks: 1 });
  const weeks = first.until(end, { largestUnit: "days" }).days / 7;
  if (weeks > MAX_WEEKS_PER_CALL) return null;
  const format = (value: Temporal.ZonedDateTime) =>
    value.toInstant().toString({ smallestUnit: "second" });
  return { utcStart: format(first), utcEnd: format(end) };
}

function periodDate(start: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(start.slice(0, 10));
}

/** Instants of a timed period; a floating time is read in the viewer's zone. */
export function periodInstants(
  period: TeamAvailabilityPeriod,
  viewerTimeZone: string,
): { start: Temporal.Instant; end: Temporal.Instant } {
  const duration = Temporal.Duration.from(period.duration);
  if (period.showWithoutTime) {
    const first = periodDate(period.start);
    const days = Math.max(1, Math.round(duration.total({ unit: "days", relativeTo: first })));
    return {
      start: first.toZonedDateTime(viewerTimeZone).toInstant(),
      end: first.add({ days }).toZonedDateTime(viewerTimeZone).toInstant(),
    };
  }
  const start = period.start.endsWith("Z")
    ? Temporal.Instant.from(period.start).toZonedDateTimeISO("UTC")
    : Temporal.PlainDateTime.from(period.start).toZonedDateTime(period.timeZone ?? viewerTimeZone);
  return { start: start.toInstant(), end: start.add(duration).toInstant() };
}

/** Dates an all-day period covers, in the viewer's zone (like all-day events on the grid). */
function periodDates(period: TeamAvailabilityPeriod): {
  first: Temporal.PlainDate;
  last: Temporal.PlainDate;
} {
  const first = periodDate(period.start);
  const duration = Temporal.Duration.from(period.duration);
  const days = Math.max(1, Math.round(duration.total({ unit: "days", relativeTo: first })));
  return { first, last: first.add({ days: days - 1 }) };
}

/**
 * A timed period counts when it overlaps the event's time. An all-day period counts when
 * it covers any date the event touches, in the viewer's zone.
 */
export function periodOverlapsEvent(
  period: TeamAvailabilityPeriod,
  span: EventAvailabilitySpan,
  viewerTimeZone: string,
): boolean {
  if (period.showWithoutTime) {
    const { first, last } = periodDates(period);
    return (
      Temporal.PlainDate.compare(first, span.lastDate) <= 0 &&
      Temporal.PlainDate.compare(last, span.firstDate) >= 0
    );
  }
  const { start, end } = periodInstants(period, viewerTimeZone);
  if (Temporal.Instant.compare(start, end) === 0) {
    return (
      Temporal.Instant.compare(start, span.start) >= 0 &&
      Temporal.Instant.compare(start, span.end) < 0
    );
  }
  return (
    Temporal.Instant.compare(start, span.end) < 0 && Temporal.Instant.compare(end, span.start) > 0
  );
}

/**
 * Attendees who are teammates sharing availability (by `CalendarInvitee.username`), keyed by
 * TeamMember id. The caller's own row is left out: the tag is about the people invited.
 */
export function teammateAttendees(
  attendees: readonly CalendarAttendee[],
  invitees: readonly CalendarInvitee[],
  members: readonly TeamAvailabilityMember[],
): Map<string, string> {
  const memberIds = new Set(members.filter((member) => !member.isSelf).map((member) => member.id));
  const byId = new Map<string, string>();
  for (const attendee of attendees) {
    if (attendee.isOrganizer) continue;
    const keys = new Set(attendeeIdentityKeys(attendee, [...invitees]));
    const invitee = invitees.find(
      (row) =>
        row.username &&
        (keys.has(normalizeParticipantAddress(row.username)) ||
          (row.email && keys.has(normalizeParticipantAddress(row.email)))),
    );
    if (invitee && memberIds.has(invitee.username)) {
      byId.set(invitee.username, normalizeParticipantAddress(attendee.email));
    }
  }
  return byId;
}

/** Turns the server answer into tags. Incomplete or missing people get none. */
export function inviteeAvailabilityFromResponse(
  people: readonly CalendarAvailabilityPerson[],
  attendeeAddressById: ReadonlyMap<string, string>,
  span: EventAvailabilitySpan,
  viewerTimeZone: string,
): Map<string, InviteeAvailability> {
  const result = new Map<string, InviteeAvailability>();
  for (const person of people) {
    const address = attendeeAddressById.get(person.id);
    if (!address || !person.complete) continue;
    const overlaps = person.periods.filter((period) =>
      periodOverlapsEvent(period, span, viewerTimeZone),
    );
    result.set(address, overlaps.length ? { status: "busy", overlaps } : { status: "free" });
  }
  return result;
}

/** A temp id of an event created offline is not on the server yet: nothing to exclude. */
export function availabilityExcludeEventId(eventId: string | undefined): string | undefined {
  const id = eventId?.trim();
  if (!id || id.startsWith("local-")) return undefined;
  return id;
}
