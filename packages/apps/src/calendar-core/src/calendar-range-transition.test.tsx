import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_RANGE_ZOOM_ATTR,
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
    document.documentElement.removeAttribute(CALENDAR_RANGE_ZOOM_ATTR);
  });

  it("uses startViewTransition with direction attribute when supported", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const update = vi.fn();
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const startViewTransition = vi.fn((arg: unknown) => {
      const cb = typeof arg === "function" ? arg : (arg as { update?: () => void }).update;
      void Promise.resolve(cb?.()).catch(() => undefined);
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
      writable: true,
    });

    const updateDone = runCalendarRangeViewTransition(document.createElement("div"), "out", update);

    await updateDone;
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.getAttribute(CALENDAR_RANGE_ZOOM_ATTR)).toBe("out");
    expect(startViewTransition).toHaveBeenCalled();
    resolveFinished();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute(CALENDAR_RANGE_ZOOM_ATTR)).toBe(false);
  });

  it("awaits an async update before resolving", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let updateStarted = false;
    const update = vi.fn(async () => {
      updateStarted = true;
      await updateGate;
    });
    const finished = Promise.resolve();
    const startViewTransition = vi.fn((arg: unknown) => {
      const cb = typeof arg === "function" ? arg : (arg as { update?: () => void }).update;
      void Promise.resolve(cb?.()).catch(() => undefined);
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
      writable: true,
    });

    let settled = false;
    const done = runCalendarRangeViewTransition(document.createElement("div"), "in", update).then(
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(updateStarted).toBe(true);
    expect(settled).toBe(false);
    releaseUpdate();
    await done;
    expect(settled).toBe(true);
  });

  it("falls back to enter-class animation when View Transitions are missing", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    const node = document.createElement("div");
    const update = vi.fn();
    await runCalendarRangeViewTransition(node, "in", update);
    expect(update).toHaveBeenCalledOnce();
    expect(node.classList.contains(CALENDAR_RANGE_ZOOM_IN_CLASS)).toBe(true);
  });

  it("skips animation when prefers-reduced-motion", async () => {
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
    const update = vi.fn();
    await runCalendarRangeViewTransition(document.createElement("div"), "in", update);
    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
