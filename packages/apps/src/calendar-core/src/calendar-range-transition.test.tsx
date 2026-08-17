import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_RANGE_TRANSITION_END_EVENT,
  CALENDAR_RANGE_ZOOM_IN_CLASS,
  CALENDAR_RANGE_ZOOM_OUT_CLASS,
  calendarRangeZoomDirection,
  restartCalendarRangeTransition,
  runCalendarRangeViewTransition,
} from "@/calendar-core/src/calendar-range-transition";

describe("calendarRangeZoomDirection", () => {
  it("zooms out when the time span widens", () => {
    expect(calendarRangeZoomDirection("day", "week")).toBe("out");
    expect(calendarRangeZoomDirection("week", "month")).toBe("out");
    expect(calendarRangeZoomDirection("month", "year")).toBe("out");
    expect(calendarRangeZoomDirection("day", "year")).toBe("out");
  });

  it("zooms in when the time span narrows", () => {
    expect(calendarRangeZoomDirection("year", "month")).toBe("in");
    expect(calendarRangeZoomDirection("month", "week")).toBe("in");
    expect(calendarRangeZoomDirection("week", "day")).toBe("in");
    expect(calendarRangeZoomDirection("year", "day")).toBe("in");
  });

  it("returns null when the range does not change", () => {
    expect(calendarRangeZoomDirection("week", "week")).toBeNull();
  });
});

describe("restartCalendarRangeTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the zoom-in class when motion is allowed", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    restartCalendarRangeTransition(node, "in");
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(true);
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(false);
  });

  it("adds the zoom-out class when widening the range", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    restartCalendarRangeTransition(node, "out");
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(true);
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(false);
  });

  it("skips transform/opacity animation when prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
      })),
    );
    const node = document.createElement("div");
    restartCalendarRangeTransition(node, "in");
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(false);
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(false);
  });

  it("dispatches calendar-range-transition-end after animationend", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    const ended = vi.fn();
    node.addEventListener(CALENDAR_RANGE_TRANSITION_END_EVENT, ended);
    restartCalendarRangeTransition(node, "out");
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(true);
    node.dispatchEvent(new Event("animationend"));
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("replaces a prior direction class when restarting", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    node.classList.add(CALENDAR_RANGE_ZOOM_OUT_CLASS);
    restartCalendarRangeTransition(node, "in");
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(true);
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(false);
  });
});

describe("runCalendarRangeViewTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs update then CSS enter animation without startViewTransition", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
      writable: true,
    });
    const node = document.createElement("div");
    const update = vi.fn();
    runCalendarRangeViewTransition(node, "out", update);
    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_OUT_CLASS)).toBe(true);
  });

  it("skips animation when prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
      })),
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
      writable: true,
    });
    const node = document.createElement("div");
    const update = vi.fn();
    runCalendarRangeViewTransition(node, "in", update);
    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(false);
  });
});
