import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import {
  resolvePendingCreateIntent,
  shouldClearHeldCreateIntent,
} from "@/calendar-core/src/calendar-pending-create";
import type { CalendarSurfaceCreateIntent } from "@/calendar-core/src/calendar-surface";

function intent(overrides: Partial<CalendarSurfaceCreateIntent> = {}): CalendarSurfaceCreateIntent {
  return {
    calendarId: "work",
    allDay: false,
    start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
    end: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
    ...overrides,
  };
}

function surfaceEvent(start: string, duration: string, allDay = false): CalendarEventsMap {
  const events: CalendarEventsMap = new Map();
  events.set("created-1", {
    eventId: "created-1",
    calendarId: "work",
    data: {
      start: Temporal.PlainDateTime.from(start),
      duration: Temporal.Duration.from(duration),
      allDay,
      summary: "Persisted",
    },
  } as CalendarEvent);
  return events;
}

describe("resolvePendingCreateIntent", () => {
  it("follows the open create form over a held save intent", () => {
    const form = emptyCalendarEventForm("work", "2033-01-12", "10:00");
    const held = intent({ title: "Held" });
    const resolved = resolvePendingCreateIntent({ mode: "create", form }, held);
    expect(resolved?.start.toString()).toBe("2033-01-12T10:00:00");
    expect(resolved?.end.toString()).toBe("2033-01-12T11:00:00");
    expect(resolved?.title).toBeUndefined();
  });

  it("keeps the held intent after the editor closes when the surface is empty", () => {
    const held = intent({ title: "Kickoff" });
    expect(resolvePendingCreateIntent(null, held)).toEqual(held);
    expect(resolvePendingCreateIntent(null, held, new Map())).toEqual(held);
  });

  it("drops the held intent once a surface event occupies the same slot", () => {
    const held = intent({ title: "Kickoff" });
    expect(
      resolvePendingCreateIntent(null, held, surfaceEvent("2033-01-12T10:00:00", "PT1H")),
    ).toBe(null);
  });

  it("returns null when nothing is held and the editor is not creating", () => {
    expect(
      resolvePendingCreateIntent(
        { mode: "edit", form: emptyCalendarEventForm("work", "2033-01-12") },
        null,
      ),
    ).toBe(null);
  });
});

describe("shouldClearHeldCreateIntent", () => {
  it("keeps the preview until start, end, and allDay match", () => {
    const held = intent();
    expect(shouldClearHeldCreateIntent(held, new Map())).toBe(false);
    expect(shouldClearHeldCreateIntent(held, surfaceEvent("2033-01-12T10:00:00", "PT30M"))).toBe(
      false,
    );
    expect(
      shouldClearHeldCreateIntent(held, surfaceEvent("2033-01-12T10:00:00", "PT1H", true)),
    ).toBe(false);
    expect(shouldClearHeldCreateIntent(held, surfaceEvent("2033-01-12T10:00:00", "PT1H"))).toBe(
      true,
    );
  });
});
