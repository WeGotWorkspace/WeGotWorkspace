import { Temporal } from "@js-temporal/polyfill";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarUtcRange } from "@/lib/calendar-load-window";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";
import {
  calendarViewLoadRange,
  useCalendarRangeLoad,
} from "@/calendar-core/src/use-calendar-range-load";

const today = Temporal.Now.plainDateISO();
const farAhead = today.add({ years: 9 }).toString();
const farBack = today.subtract({ years: 2 }).toString();
const nearby = today.add({ days: 14 }).toString();

type Props = { view: CalendarViewId; anchor: string; enabled: boolean };

function setup(initial: Props, loadRange = vi.fn(async (_range: CalendarUtcRange) => true)) {
  const onLoaded = vi.fn();
  const hook = renderHook(
    (props: Props) => useCalendarRangeLoad({ ...props, loadRange, onLoaded }),
    {
      initialProps: initial,
    },
  );
  return { ...hook, loadRange, onLoaded };
}

const utcRange = (start: string, end: string) => ({
  utcStart: new Date(`${start}T00:00:00Z`),
  utcEnd: new Date(`${end}T00:00:00Z`),
});

describe("calendarViewLoadRange", () => {
  it("pads the rendered week by a week on each side", () => {
    // Week of Wednesday 2033-01-12 renders Monday 01-10 to Monday 01-17.
    expect(calendarViewLoadRange("week", "2033-01-12")).toEqual(
      utcRange("2033-01-03", "2033-01-24"),
    );
  });

  it("covers the whole month grid", () => {
    const loaded = calendarViewLoadRange("month", "2024-10-01");
    expect(loaded.utcStart.getTime()).toBeLessThanOrEqual(Date.parse("2024-09-30T00:00:00Z"));
    expect(loaded.utcEnd.getTime()).toBeGreaterThanOrEqual(Date.parse("2024-11-04T00:00:00Z"));
  });
});

describe("useCalendarRangeLoad (#1675)", () => {
  it("loads a week far ahead of the bootstrap window and re-reads the cache", async () => {
    const { loadRange, onLoaded } = setup({ view: "week", anchor: farAhead, enabled: true });

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(loadRange).toHaveBeenCalledTimes(1);
    const range = loadRange.mock.calls[0]![0];
    const anchorMs = Date.parse(`${farAhead}T12:00:00Z`);
    expect(range.utcStart.getTime()).toBeLessThan(anchorMs);
    expect(range.utcEnd.getTime()).toBeGreaterThan(anchorMs);
  });

  it("loads a week more than a year back", async () => {
    const { loadRange, onLoaded } = setup({ view: "week", anchor: farBack, enabled: true });

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(loadRange).toHaveBeenCalledTimes(1);
  });

  it("does not load a week inside the bootstrap window", async () => {
    const { loadRange } = setup({ view: "week", anchor: nearby, enabled: true });

    await Promise.resolve();
    expect(loadRange).not.toHaveBeenCalled();
  });

  it("loads a period once, including a day inside an already loaded month", async () => {
    const { loadRange, onLoaded, rerender } = setup({
      view: "month",
      anchor: farAhead,
      enabled: true,
    });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));

    rerender({ view: "day", anchor: farAhead, enabled: true });
    rerender({ view: "month", anchor: farAhead, enabled: true });
    await Promise.resolve();

    expect(loadRange).toHaveBeenCalledTimes(1);
  });

  it("waits while disabled (offline or first bootstrap) and loads once enabled", async () => {
    const { loadRange, onLoaded, rerender } = setup({
      view: "week",
      anchor: farAhead,
      enabled: false,
    });
    await Promise.resolve();
    expect(loadRange).not.toHaveBeenCalled();

    rerender({ view: "week", anchor: farAhead, enabled: true });

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
  });

  it("retries a period whose load failed on the next chance", async () => {
    const loadRange = vi
      .fn(async (_range: CalendarUtcRange) => true)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { onLoaded, rerender } = setup(
      { view: "week", anchor: farAhead, enabled: true },
      loadRange,
    );
    await waitFor(() => expect(loadRange).toHaveBeenCalledTimes(1));
    expect(onLoaded).not.toHaveBeenCalled();

    rerender({ view: "week", anchor: farAhead, enabled: false });
    rerender({ view: "week", anchor: farAhead, enabled: true });

    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(loadRange).toHaveBeenCalledTimes(2);
  });
});
