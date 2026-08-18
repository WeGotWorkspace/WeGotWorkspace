import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "../types/event.js";
import { UTC_TIMEZONE } from "../types/event/timezone.js";
import { resolveEventEnd } from "../utils/recurrence.js";
import { EventsAPI } from "../core/reducer/index.js";
import {
  createDailySeriesState,
  createWeeklySeriesWithExceptionState,
} from "./support/mockEvents.js";

describe("EventsAPI", () => {
  it("moves a series and shifts exclusions while preserving exception timing", () => {
    const state: CalendarEventsMap = new Map([
      [
        "daily",
        {
          eventId: "daily@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            color: "#10B981",
            recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
            exclusionDates: new Set(["20250114T090000"]),
          },
        },
      ],
      [
        "daily::20250115T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250115T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-15T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-15T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state);

    api.move({
      target: { key: "daily" },
      scope: "series",
      delta: Temporal.Duration.from({ hours: 1 }),
    });

    const next = api.events;
    expect(next.get("daily")?.data.start.toString()).toBe("2025-01-13T10:00:00");
    expect(next.get("daily")?.data.exclusionDates?.has("20250114T100000")).toBe(true);
    expect(next.get("daily::20250115T090000")?.data.start.toString()).toBe("2025-01-15T11:00:00");
    expect(next.get("daily::20250115T090000")?.recurrenceId).toBe("20250115T100000");
  });

  it("deleting exception keeps exclusion on master", () => {
    const state: CalendarEventsMap = new Map([
      [
        "daily",
        {
          eventId: "daily@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            color: "#10B981",
            recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
          },
        },
      ],
      [
        "daily::20250114T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250114T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-14T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-14T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state);

    api.removeException({
      target: { key: "daily::20250114T090000" },
      options: { asExclusion: true },
    });

    const next = api.events;
    expect(next.has("daily::20250114T090000")).toBe(false);
    expect(next.get("daily")?.data.exclusionDates?.has("20250114T090000")).toBe(true);
  });

  it("resizing series start should shift exclusions with the new occurrence start", () => {
    const state = createDailySeriesState();
    state.set("daily", {
      ...state.get("daily")!,
      data: {
        ...state.get("daily")!.data,
        exclusionDates: new Set(["20250114T090000"]),
      },
    });
    const api = new EventsAPI(state);

    api.resizeStart({
      target: { key: "daily" },
      scope: "series",
      toStart: Temporal.PlainDateTime.from("2025-01-13T08:30:00"),
    });

    const next = api.events;
    expect(next.get("daily")?.data.exclusionDates?.has("20250114T083000")).toBe(true);
    expect(next.get("daily")?.data.exclusionDates?.has("20250114T090000")).toBe(false);
  });

  it("resizing series start should not resize detached exceptions", () => {
    const state: CalendarEventsMap = new Map([
      ...createDailySeriesState(),
      [
        "daily::20250115T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250115T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-15T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-15T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state);

    api.resizeStart({
      target: { key: "daily" },
      scope: "series",
      toStart: Temporal.PlainDateTime.from("2025-01-13T08:30:00"),
    });

    const next = api.events;
    const exception = next.get("daily::20250115T090000");
    expect(exception?.data.start.toString()).toBe("2025-01-15T11:00:00");
    expect(exception ? resolveEventEnd(exception.data).toString() : undefined).toBe(
      "2025-01-15T11:15:00",
    );
  });

  it("resizing series start shifts detached exception recurrence anchor", () => {
    const state: CalendarEventsMap = new Map([
      [
        "daily",
        {
          eventId: "daily@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            color: "#10B981",
            recurrenceRule: { freq: "DAILY", interval: 1, count: 4 },
            exclusionDates: new Set(["20250115T090000"]),
          },
        },
      ],
      [
        "daily::20250115T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250115T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-15T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-15T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state);

    api.resizeStart({
      target: { key: "daily" },
      scope: "series",
      toStart: Temporal.PlainDateTime.from("2025-01-13T08:30:00"),
    });

    const next = api.events;
    const exception = next.get("daily::20250115T090000");
    expect(exception?.data.start.toString()).toBe("2025-01-15T11:00:00");
    expect(exception ? resolveEventEnd(exception.data).toString() : undefined).toBe(
      "2025-01-15T11:15:00",
    );
    expect(exception?.recurrenceId).toBe("20250115T083000");
    expect(next.get("daily")?.data.exclusionDates?.has("20250115T083000")).toBe(true);
    expect(next.get("daily")?.data.exclusionDates?.has("20250115T090000")).toBe(false);
  });

  it("moving a detached exception keeps original recurrence anchor and suppresses master occurrence", () => {
    const api = new EventsAPI(createWeeklySeriesWithExceptionState());

    api.move({
      target: { key: "weekly::20250120T090000" },
      scope: "single",
      delta: Temporal.Duration.from({ hours: 1 }),
    });

    const next = api.events;
    const movedException = next.get("weekly::20250120T090000");
    expect(movedException?.data.start.toString()).toBe("2025-01-20T14:00:00");
    expect(movedException ? resolveEventEnd(movedException.data).toString() : undefined).toBe(
      "2025-01-20T15:00:00",
    );
    expect(movedException?.recurrenceId).toBe("20250120T090000");

    const expanded = api.expand({
      start: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-21T00:00:00"),
    });

    expect(expanded.has("weekly::20250120T090000")).toBe(true);
    expect(Array.from(expanded.keys())).toEqual(["weekly::20250120T090000"]);
  });

  it("tracks update and delete as pending when enabled", () => {
    const state: CalendarEventsMap = new Map([
      [
        "single",
        {
          eventId: "single@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T10:00:00"),
            summary: "Single",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state, { trackPending: true });

    api.update({
      target: { key: "single" },
      scope: "single",
      patch: { summary: "Single (edited)" },
    });
    expect(api.events.get("single")?.pendingOp).toBe("updated");

    api.remove({
      target: { key: "single" },
      scope: "single",
    });
    const next = api.events;
    expect(next.get("single")?.pendingOp).toBe("deleted");
  });

  it("drops locally created events when deleted in pending mode", () => {
    const state: CalendarEventsMap = new Map([
      [
        "draft",
        {
          eventId: "draft@example.test",
          pendingOp: "created",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T10:00:00"),
            summary: "Draft",
            color: "#10B981",
          },
        },
      ],
    ]);
    const api = new EventsAPI(state, { trackPending: true });

    api.remove({
      target: { key: "draft" },
      scope: "single",
    });
    expect(api.events.has("draft")).toBe(false);
  });

  it("series update skips detached exceptions", () => {
    const state = createWeeklySeriesWithExceptionState();
    const api = new EventsAPI(state, { trackPending: true });

    api.update({
      target: { key: "weekly" },
      scope: "series",
      patch: { summary: "Weekly (series updated)" },
    });

    const next = api.events;
    expect(next.get("weekly")?.data.summary).toBe("Weekly (series updated)");
    expect(next.get("weekly")?.pendingOp).toBe("updated");
    expect(next.get("weekly::20250120T090000")?.data.summary).toBe("Weekly (moved)");
    expect(next.get("weekly::20250120T090000")?.pendingOp).toBeUndefined();
  });

  it("series move updates exception recurrence anchors without pending updates", () => {
    const api = new EventsAPI(createWeeklySeriesWithExceptionState(), { trackPending: true });

    api.move({
      target: { key: "weekly" },
      scope: "series",
      delta: Temporal.Duration.from({ hours: 1 }),
    });

    const next = api.events;
    expect(next.get("weekly")?.pendingOp).toBe("updated");
    expect(next.get("weekly::20250120T090000")?.recurrenceId).toBe("20250120T100000");
    expect(next.get("weekly::20250120T090000")?.pendingOp).toBeUndefined();
  });

  it("create preserves allDay and timeZone on new events", () => {
    const api = new EventsAPI(new Map());

    api.create({
      event: {
        data: {
          summary: "All-day create",
          start: Temporal.PlainDateTime.from("2025-03-01T00:00:00"),
          end: Temporal.PlainDateTime.from("2025-03-02T00:00:00"),
          allDay: true,
          timeZone: UTC_TIMEZONE,
        },
      },
    });

    const created = [...api.events.values()][0];
    expect(created?.data.allDay).toBe(true);
    expect(created?.data.timeZone).toBe(UTC_TIMEZONE);
  });
});
