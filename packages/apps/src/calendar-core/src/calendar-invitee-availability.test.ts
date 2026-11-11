import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  availabilityExcludeEventId,
  availabilityWeekRange,
  eventAvailabilitySpan,
  inviteeAvailabilityFromResponse,
  jmapTeamAvailabilitySource,
  periodOverlapsEvent,
  teammateAttendees,
  type TeamAvailabilityPeriod,
} from "@/calendar-core/src/calendar-invitee-availability";
import type { CalendarAttendee, CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import { JmapClient } from "@/lib/jmap-client";
import { timedEvent } from "@/lib/jmap-client/mock/fixtures";
import { MockJmapServer } from "@/lib/jmap-client/mock/MockJmapServer";

const ZONE = "Europe/Amsterdam";

function timedForm(start: string, end: string, timeZone: string | null = ZONE) {
  const [startDate, startTime] = start.split("T");
  const [endDate, endTime] = end.split("T");
  return { allDay: false, startDate, startTime, endDate, endTime, timeZone };
}

function allDayForm(startDate: string, endDate: string) {
  return { allDay: true, startDate, startTime: "00:00", endDate, endTime: "00:00", timeZone: null };
}

function timed(start: string, duration: string, timeZone: string | null = null) {
  return { start, timeZone, duration, showWithoutTime: false } satisfies TeamAvailabilityPeriod;
}

function allDay(start: string, duration = "P1D") {
  return {
    start,
    timeZone: null,
    duration,
    showWithoutTime: true,
  } satisfies TeamAvailabilityPeriod;
}

describe("eventAvailabilitySpan", () => {
  it("reads a timed event in its own zone and an all-day event in the viewer's", () => {
    const span = eventAvailabilitySpan(timedForm("2030-01-08T10:00", "2030-01-08T11:00"), ZONE)!;
    expect(span.start.toString()).toBe("2030-01-08T09:00:00Z");
    expect(span.end.toString()).toBe("2030-01-08T10:00:00Z");

    const day = eventAvailabilitySpan(allDayForm("2030-01-08", "2030-01-09"), ZONE)!;
    expect(day.start.toString()).toBe("2030-01-07T23:00:00Z");
    expect(day.end.toString()).toBe("2030-01-09T23:00:00Z");
    expect(day.firstDate.toString()).toBe("2030-01-08");
    expect(day.lastDate.toString()).toBe("2030-01-09");
  });

  it("reads a floating time in the viewer's zone and rejects an end before the start", () => {
    const span = eventAvailabilitySpan(
      timedForm("2030-01-08T10:00", "2030-01-08T11:00", null),
      "America/New_York",
    )!;
    expect(span.start.toString()).toBe("2030-01-08T15:00:00Z");
    expect(eventAvailabilitySpan(timedForm("2030-01-08T10:00", "2030-01-08T09:00"), ZONE)).toBe(
      null,
    );
  });
});

describe("availabilityWeekRange", () => {
  it("snaps to the whole UTC week that holds the event", () => {
    const span = eventAvailabilitySpan(timedForm("2030-01-09T10:00", "2030-01-09T11:00"), ZONE)!;
    expect(availabilityWeekRange(span)).toEqual({
      utcStart: "2030-01-07T00:00:00Z",
      utcEnd: "2030-01-14T00:00:00Z",
    });
  });

  it("adds the neighbouring week when the event sits near a week edge", () => {
    // Monday 08:00 Amsterdam is within 14 h of Monday 00:00 UTC.
    const span = eventAvailabilitySpan(timedForm("2030-01-07T08:00", "2030-01-07T09:00"), ZONE)!;
    expect(availabilityWeekRange(span)).toEqual({
      utcStart: "2029-12-31T00:00:00Z",
      utcEnd: "2030-01-14T00:00:00Z",
    });
  });

  it("covers every week of a long event and gives up over 54 weeks", () => {
    const span = eventAvailabilitySpan(allDayForm("2030-01-09", "2030-01-23"), ZONE)!;
    expect(availabilityWeekRange(span)).toEqual({
      utcStart: "2030-01-07T00:00:00Z",
      utcEnd: "2030-01-28T00:00:00Z",
    });
    const year = eventAvailabilitySpan(allDayForm("2030-01-09", "2031-03-01"), ZONE)!;
    expect(availabilityWeekRange(year)).toBe(null);
  });
});

describe("periodOverlapsEvent", () => {
  const span = eventAvailabilitySpan(timedForm("2030-01-08T10:00", "2030-01-08T11:00"), ZONE)!;

  it("counts timed periods that overlap, not ones that only touch", () => {
    expect(periodOverlapsEvent(timed("2030-01-08T09:30:00Z", "PT1H"), span, ZONE)).toBe(true);
    expect(periodOverlapsEvent(timed("2030-01-08T10:00:00Z", "PT1H"), span, ZONE)).toBe(false);
    expect(periodOverlapsEvent(timed("2030-01-08T08:00:00Z", "PT1H"), span, ZONE)).toBe(false);
    expect(periodOverlapsEvent(timed("2030-01-08T10:30:00", "PT1H", ZONE), span, ZONE)).toBe(true);
  });

  it("makes a busy all-day period on any date the event touches count (viewer's zone)", () => {
    expect(periodOverlapsEvent(allDay("2030-01-08"), span, ZONE)).toBe(true);
    expect(periodOverlapsEvent(allDay("2030-01-07", "P2D"), span, ZONE)).toBe(true);
    expect(periodOverlapsEvent(allDay("2030-01-09"), span, ZONE)).toBe(false);

    const overnight = eventAvailabilitySpan(
      timedForm("2030-01-08T23:00", "2030-01-09T01:00"),
      ZONE,
    )!;
    expect(periodOverlapsEvent(allDay("2030-01-09"), overnight, ZONE)).toBe(true);
    const allDayEvent = eventAvailabilitySpan(allDayForm("2030-01-09", "2030-01-09"), ZONE)!;
    expect(periodOverlapsEvent(timed("2030-01-09T12:00:00Z", "PT1H"), allDayEvent, ZONE)).toBe(
      true,
    );
  });
});

describe("teammateAttendees", () => {
  const invitees: CalendarInvitee[] = [
    { username: "ann", email: "ann@example.test", name: "Ann" },
    { username: "bob", email: "bob@example.test", name: "Bob" },
    { username: "me", email: "me@example.test", name: "Me" },
  ];
  const members = [
    { id: "ann", name: "Ann", isSelf: false, version: "1" },
    { id: "me", name: "Me", isSelf: true, version: "1" },
  ];
  const attendee = (email: string, extra: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
    email,
    name: email,
    participationStatus: "needs-action",
    ...extra,
  });

  it("matches invitees to TeamMember ids by username and skips everyone else", () => {
    const map = teammateAttendees(
      [
        attendee("Ann@Example.test"),
        attendee("bob@example.test"),
        attendee("guest@elsewhere.test"),
        attendee("me@example.test", { isOrganizer: true }),
      ],
      invitees,
      members,
    );
    expect([...map.entries()]).toEqual([["ann", "ann@example.test"]]);
  });
});

describe("inviteeAvailabilityFromResponse", () => {
  const span = eventAvailabilitySpan(timedForm("2030-01-08T10:00", "2030-01-08T11:00"), ZONE)!;
  const addresses = new Map([
    ["ann", "ann@example.test"],
    ["cy", "cy@example.test"],
    ["dee", "dee@example.test"],
  ]);

  it("says busy with the overlaps, free without, and nothing on partial data", () => {
    const busyPeriod = timed("2030-01-08T09:30:00Z", "PT30M");
    const result = inviteeAvailabilityFromResponse(
      [
        { id: "ann", complete: true, periods: [busyPeriod, timed("2030-01-08T12:00:00Z", "PT1H")] },
        { id: "cy", complete: true, periods: [] },
        { id: "dee", complete: false, periods: [] },
      ],
      addresses,
      span,
      ZONE,
    );
    expect(result.get("ann@example.test")).toEqual({ status: "busy", overlaps: [busyPeriod] });
    expect(result.get("cy@example.test")).toEqual({ status: "free" });
    expect(result.has("dee@example.test")).toBe(false);
  });
});

describe("availabilityExcludeEventId", () => {
  it("passes a saved id and drops temp ids of offline creates", () => {
    expect(availabilityExcludeEventId("ev-1")).toBe("ev-1");
    expect(availabilityExcludeEventId("local-abc")).toBeUndefined();
    expect(availabilityExcludeEventId(undefined)).toBeUndefined();
  });
});

describe("jmapTeamAvailabilitySource", () => {
  it("calls TeamMember/get and TeamMember/getAvailability on the mock server", async () => {
    const server = new MockJmapServer();
    server.availability.seedTeamMember({ id: "ann", name: "Ann", isSelf: false, version: "v1" });
    server.availability.seedBusyPeriods("ann", [
      { ...timed("2030-01-08T09:00:00Z", "PT1H"), eventId: timedEvent.id },
      timed("2030-01-08T13:00:00Z", "PT1H"),
    ]);
    server.seedEvent(timedEvent);
    const source = jmapTeamAvailabilitySource(
      new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch }),
    );

    expect((await source.teamMembers()).map((member) => member.id)).toEqual(["ann"]);
    const week = { utcStart: "2030-01-07T00:00:00Z", utcEnd: "2030-01-14T00:00:00Z" };
    expect((await source.availability({ ids: ["ann"], ...week }))[0].periods).toHaveLength(2);
    const excluded = await source.availability({
      ids: ["ann"],
      ...week,
      excludeEventId: timedEvent.id,
    });
    expect(excluded[0].periods.map((period) => period.start)).toEqual(["2030-01-08T13:00:00Z"]);
    expect(Temporal.Instant.from(week.utcStart).toZonedDateTimeISO("UTC").dayOfWeek).toBe(1);
  });
});
