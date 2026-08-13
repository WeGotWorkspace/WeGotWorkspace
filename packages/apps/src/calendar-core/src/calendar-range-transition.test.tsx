import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_RANGE_TRANSITION_CLASS,
  restartCalendarRangeTransition,
} from "@/calendar-core/src/calendar-range-transition";

describe("restartCalendarRangeTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the animate class when motion is allowed", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    restartCalendarRangeTransition(node);
    expect(node.classList.contains(CALENDAR_RANGE_TRANSITION_CLASS)).toBe(true);
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
    restartCalendarRangeTransition(node);
    expect(node.classList.contains(CALENDAR_RANGE_TRANSITION_CLASS)).toBe(false);
  });

  it("restarts when the class was already present", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "(prefers-reduced-motion: reduce)" }),
    );
    const node = document.createElement("div");
    node.classList.add(CALENDAR_RANGE_TRANSITION_CLASS);
    restartCalendarRangeTransition(node);
    expect(node.classList.contains(CALENDAR_RANGE_TRANSITION_CLASS)).toBe(true);
  });
});
