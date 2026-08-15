import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "../calendars/types.js";
import {
  collectInternalGroup,
  internalGroupToJmapEvent,
  jmapEventToInternalRows,
} from "../mapping/event.js";
import { internalRecurrenceRuleToJs, jsRecurrenceRuleToInternal } from "../mapping/recurrence.js";
import { allDayEvent, recurringEvent, timedEvent } from "../mock/fixtures.js";

function roundTrip(jmapEvent: JmapCalendarEvent): Omit<JmapCalendarEvent, "id"> {
  const rows = jmapEventToInternalRows(jmapEvent, { accountId: "account1" });
  const events = new Map(rows.map((row) => [row.key, row.event]));
  const group = collectInternalGroup(events, jmapEvent.id);
  if (!group) throw new Error("missing group");
  return internalGroupToJmapEvent(group, { original: jmapEvent });
}

describe("jmapEventToInternalRows", () => {
  it("maps a timed event", () => {
    const [row, ...rest] = jmapEventToInternalRows(timedEvent, { accountId: "account1" });
    expect(rest).toHaveLength(0);
    expect(row.key).toBe("ev-timed");
    expect(row.event.eventId).toBe("uid-timed-1");
    expect(row.event.calendarId).toBe("cal-work");
    expect(row.event.data.summary).toBe("Design review");
    expect(row.event.data.start.toString()).toBe("2026-03-10T10:00:00");
    expect(row.event.data.duration?.toString()).toBe("PT1H30M");
    expect(row.event.data.timeZone).toBe("Europe/Amsterdam");
    expect(row.event.data.location).toBe("Room 4");
    expect(row.event.data.allDay).toBeUndefined();
  });

  it("maps an all-day event", () => {
    const [row] = jmapEventToInternalRows(allDayEvent);
    expect(row.event.data.allDay).toBe(true);
    expect(row.event.data.duration?.toString()).toBe("P2D");
  });

  it("maps recurrence, exclusions and overrides to master + exception rows", () => {
    const rows = jmapEventToInternalRows(recurringEvent);
    expect(rows).toHaveLength(2);
    const [master, exception] = rows;

    expect(master.event.isRecurring).toBe(true);
    expect(master.event.data.recurrenceRule).toEqual({
      freq: "WEEKLY",
      byDay: [{ day: "MO" }, { day: "WE" }],
    });
    expect(master.event.data.exclusionDates).toEqual(new Set(["20260309T090000"]));

    expect(exception.key).toBe("ev-recurring::20260311T090000");
    expect(exception.event.isException).toBe(true);
    expect(exception.event.recurrenceId).toBe("20260311T090000");
    expect(exception.event.data.summary).toBe("Standup (moved)");
    expect(exception.event.data.start.toString()).toBe("2026-03-11T11:00:00");
  });

  it("derives duration from end when CalDAV/Apple-style payload omits duration", () => {
    // Mirrors Synct ie: DTSTART/DTEND → JMAP end without duration (Apple PRODID).
    const appleStyle: JmapCalendarEvent = {
      "@type": "Event",
      id: "synct-ie-a85ff58a",
      uid: "urn:uuid:880a4b2e-2a2e-4ea3-ac57-935b80844291",
      title: "Synct ie",
      start: "2026-08-10T10:00:00",
      end: "2026-08-10T14:00:00",
      calendarIds: { default: true },
      recurrenceRules: [
        {
          "@type": "RecurrenceRule",
          frequency: "weekly",
          byDay: [
            { "@type": "NDay", day: "mo" },
            { "@type": "NDay", day: "tu" },
            { "@type": "NDay", day: "we" },
            { "@type": "NDay", day: "th" },
            { "@type": "NDay", day: "fr" },
          ],
        },
      ],
      recurrenceOverrides: {
        "2026-08-11T10:00:00": { excluded: true },
      },
    };
    const [row] = jmapEventToInternalRows(appleStyle);
    expect(row.event.data.duration?.toString()).toBe("PT4H");
    expect(row.event.data.start.toString()).toBe("2026-08-10T10:00:00");
    expect(row.event.data.exclusionDates).toEqual(new Set(["20260811T100000"]));
  });

  it("prefers explicit duration over end when both are present", () => {
    const both: JmapCalendarEvent = {
      ...timedEvent,
      duration: "PT45M",
      end: "2026-03-10T18:00:00",
    };
    const [row] = jmapEventToInternalRows(both);
    expect(row.event.data.duration?.toString()).toBe("PT45M");
  });
});

describe("internalGroupToJmapEvent", () => {
  it("round-trips a timed event and preserves opaque properties", () => {
    const result = roundTrip(timedEvent);
    expect(result.title).toBe("Design review");
    expect(result.start).toBe("2026-03-10T10:00:00");
    expect(result.duration).toBe("PT1H30M");
    expect(result.timeZone).toBe("Europe/Amsterdam");
    expect(result.calendarIds).toEqual({ "cal-work": true });
    // Untouched opaque payload:
    expect(result.participants).toEqual(timedEvent.participants);
    expect(result.alerts).toEqual(timedEvent.alerts);
    expect(result.privacy).toBe("public");
    // Location object keeps its extra description property:
    expect(result.locations).toEqual({
      loc1: { "@type": "Location", name: "Room 4", description: "4th floor" },
    });
    // Server-set props are stripped:
    expect("id" in result).toBe(false);
  });

  it("round-trips recurrence overrides and keeps unmanaged patch keys", () => {
    const result = roundTrip(recurringEvent);
    expect(result.recurrenceRules).toEqual([
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [
          { "@type": "NDay", day: "mo" },
          { "@type": "NDay", day: "we" },
        ],
      },
    ]);
    const overrides = (result.recurrenceOverrides ?? {}) as Record<string, Record<string, unknown>>;
    expect(overrides["2026-03-09T09:00:00"]).toEqual({ excluded: true });
    const patch = overrides["2026-03-11T09:00:00"];
    expect(patch.title).toBe("Standup (moved)");
    expect(patch.start).toBe("2026-03-11T11:00:00");
    // The unmanaged alert-offset patch key survives:
    expect(patch["alerts/a1/trigger/offset"]).toBe("-PT5M");
  });

  it("keeps multi-calendar membership when the calendar is unchanged", () => {
    const multi: JmapCalendarEvent = {
      ...timedEvent,
      calendarIds: { "cal-work": true, "cal-personal": true },
    };
    const result = roundTrip(multi);
    expect(result.calendarIds).toEqual({ "cal-work": true, "cal-personal": true });
  });

  it("rewrites calendarIds when the event moved to another calendar", () => {
    const rows = jmapEventToInternalRows(timedEvent);
    const events = new Map(rows.map((row) => [row.key, row.event]));
    const master = events.get("ev-timed");
    if (!master) throw new Error("missing master");
    events.set("ev-timed", { ...master, calendarId: "cal-personal" });
    const group = collectInternalGroup(events, "ev-timed");
    if (!group) throw new Error("missing group");
    const result = internalGroupToJmapEvent(group, { original: timedEvent });
    expect(result.calendarIds).toEqual({ "cal-personal": true });
  });

  it("serializes end-based internal spans as durations", () => {
    const start = Temporal.PlainDateTime.from("2026-05-01T08:00:00");
    const result = internalGroupToJmapEvent({
      masterKey: "local-1",
      master: {
        eventId: "uid-local-1",
        data: { start, end: start.add({ hours: 2 }), summary: "Local" },
      },
      exceptions: new Map(),
    });
    expect(result.duration).toBe("PT2H");
    expect(result.uid).toBe("uid-local-1");
    expect(result["@type"]).toBe("Event");
  });
});

describe("recurrence rule mapping", () => {
  it("maps ordinals, count and until in both directions", () => {
    const js = {
      "@type": "RecurrenceRule" as const,
      frequency: "monthly" as const,
      interval: 2,
      firstDayOfWeek: "mo" as const,
      byDay: [{ "@type": "NDay" as const, day: "fr" as const, nthOfPeriod: -1 }],
      count: 10,
    };
    const internal = jsRecurrenceRuleToInternal(js);
    if (!internal) throw new Error("expected mapped rule");
    expect(internal).toEqual({
      freq: "MONTHLY",
      interval: 2,
      wkst: "MO",
      byDay: [{ day: "FR", ordinal: -1 }],
      count: 10,
    });
    expect(internalRecurrenceRuleToJs(internal)).toEqual(js);

    const untilRule = jsRecurrenceRuleToInternal({
      frequency: "daily",
      until: "2026-12-31T00:00:00",
    });
    if (!untilRule) throw new Error("expected mapped rule");
    expect(untilRule.until?.toString()).toBe("2026-12-31T00:00:00");
    expect(internalRecurrenceRuleToJs(untilRule).until).toBe("2026-12-31T00:00:00");
  });
});
