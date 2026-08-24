import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { createDailySeriesState } from "@/lib/calendar-engine/tests/support/mockEvents.js";
import * as expandModule from "@/lib/calendar-engine";
import { cachedVisibleEventsInRange } from "./renderedEvents.js";

const RANGE = {
  start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
  end: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
};

describe("cachedVisibleEventsInRange", () => {
  it("returns the same map when events identity, range, and timezone are unchanged", () => {
    const expandSpy = vi.spyOn(expandModule, "expandEvents");
    const events = createDailySeriesState();
    const first = cachedVisibleEventsInRange(null, events, RANGE, "UTC");
    const second = cachedVisibleEventsInRange(first.cache, events, RANGE, "UTC");

    expect(second.value).toBe(first.value);
    expect(expandSpy).toHaveBeenCalledTimes(1);
    expandSpy.mockRestore();
  });

  it("recomputes when the events map is replaced", () => {
    const first = cachedVisibleEventsInRange(null, createDailySeriesState(), RANGE, "UTC");
    const second = cachedVisibleEventsInRange(first.cache, createDailySeriesState(), RANGE, "UTC");

    expect(second.value).not.toBe(first.value);
    expect(second.value.size).toBe(first.value.size);
  });

  it("recomputes when the visible range changes", () => {
    const events = createDailySeriesState();
    const first = cachedVisibleEventsInRange(null, events, RANGE, "UTC");
    const second = cachedVisibleEventsInRange(
      first.cache,
      events,
      {
        start: Temporal.PlainDateTime.from("2025-02-01T00:00:00"),
        end: Temporal.PlainDateTime.from("2025-02-08T00:00:00"),
      },
      "UTC",
    );

    expect(second.value).not.toBe(first.value);
    expect(second.value.size).toBe(0);
  });

  it("omits declined participants", () => {
    const events: CalendarEventsMap = new Map([
      [
        "accepted",
        {
          eventId: "accepted@example.test",
          participationStatus: "accepted",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T10:00:00"),
            summary: "Accepted",
          },
        },
      ],
      [
        "declined",
        {
          eventId: "declined@example.test",
          participationStatus: "declined",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T12:00:00"),
            summary: "Declined",
          },
        },
      ],
    ]);

    const { value } = cachedVisibleEventsInRange(null, events, RANGE, "UTC");
    expect(value.has("accepted")).toBe(true);
    expect(value.has("declined")).toBe(false);
  });
});
