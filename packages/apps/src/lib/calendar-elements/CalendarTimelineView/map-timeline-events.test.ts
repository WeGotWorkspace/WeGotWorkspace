import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { UTC_TIMEZONE, type CalendarEvent } from "@/lib/calendar-engine";
import {
  dayOverflowPopoverEvents,
  mapTimelineOccurrenceEvents,
  timelineRsvp,
} from "./map-timeline-events.js";

const SCALE = {
  startDate: Temporal.PlainDate.from("2025-01-13"),
  numDays: 1,
  unitsPerDay: 24 * 60,
};

describe("mapTimelineOccurrenceEvents", () => {
  it("places a UTC timed event later on the Europe/Amsterdam day grid", () => {
    const event: CalendarEvent = {
      eventId: "standup@example.test",
      data: {
        start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
        end: Temporal.PlainDateTime.from("2025-01-13T09:30:00"),
        summary: "Standup",
        timeZone: UTC_TIMEZONE,
      },
    };
    const [utc] = mapTimelineOccurrenceEvents([["standup", event]], "timed", {
      now: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
      pending: null,
      scale: SCALE,
      displayTimeZone: "UTC",
      resolveColor: () => "#000",
    });
    const [amsterdam] = mapTimelineOccurrenceEvents([["standup", event]], "timed", {
      now: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
      pending: null,
      scale: SCALE,
      displayTimeZone: "Europe/Amsterdam",
      resolveColor: () => "#000",
    });
    expect(utc?.start).toBe(9 * 60);
    expect(amsterdam?.start).toBe(10 * 60);
    expect(amsterdam?.originalStart.toString()).toBe("2025-01-13T09:00:00");
    expect(amsterdam?.displayStart.toString()).toBe("2025-01-13T10:00:00");
    expect(utc?.displayStart.toString()).toBe("2025-01-13T09:00:00");
  });
});

describe("year day lists", () => {
  it("pass the overlay kind and RSVP to the day list cards", () => {
    const [busy] = dayOverflowPopoverEvents([
      {
        key: "availability:ada#0",
        summary: "Busy",
        color: "#8b5cf6",
        displayStart: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
        displayEnd: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        allDay: false,
        rsvp: "",
        overlayKind: "availability",
        hasMeeting: false,
      },
    ]);
    expect(busy).toMatchObject({
      id: "availability:ada#0",
      start: "2033-01-12T10:00:00",
      summary: "Busy",
      overlay: "availability",
    });
  });

  it("styles only invitations awaiting a reply or answered maybe", () => {
    const event = (participationStatus?: CalendarEvent["participationStatus"]): CalendarEvent => ({
      eventId: "e",
      participationStatus,
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
        duration: Temporal.Duration.from({ hours: 1 }),
        summary: "x",
      },
    });
    expect(timelineRsvp(event("needs-action"))).toBe("needs-action");
    expect(timelineRsvp(event("tentative"))).toBe("tentative");
    expect(timelineRsvp(event("accepted"))).toBe("");
    expect(timelineRsvp(event())).toBe("");
  });
});

describe("meeting flag", () => {
  const meetingEvent: CalendarEvent = {
    eventId: "call@example.test",
    data: {
      start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-13T09:30:00"),
      summary: "Call",
      hasMeeting: true,
    },
  };
  const args = {
    now: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
    pending: null,
    scale: SCALE,
    displayTimeZone: "UTC",
    resolveColor: () => "#000",
  };

  it("carries hasMeeting to timed and all-day cards, and to the +N popover", () => {
    const [timed] = mapTimelineOccurrenceEvents([["call", meetingEvent]], "timed", args);
    const [allDay] = mapTimelineOccurrenceEvents([["call", meetingEvent]], "all-day", args);
    expect(timed?.hasMeeting).toBe(true);
    expect(allDay?.hasMeeting).toBe(true);
    const [popover] = dayOverflowPopoverEvents([
      {
        key: "call",
        summary: "Call",
        color: "#000",
        displayStart: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
        displayEnd: Temporal.PlainDateTime.from("2025-01-13T09:30:00"),
        allDay: false,
        rsvp: "",
        hasMeeting: true,
      },
    ]);
    expect(popover?.hasMeeting).toBe(true);
  });

  it("is false without a meeting link", () => {
    const plain = { ...meetingEvent, data: { ...meetingEvent.data, hasMeeting: undefined } };
    expect(mapTimelineOccurrenceEvents([["call", plain]], "timed", args)[0]?.hasMeeting).toBe(
      false,
    );
  });
});
