import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { MEET_NOW_TICK_MS, useMeetNowClock } from "@/meet-core/src/use-meet-now-clock";

describe("useMeetNowClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances after the meet tick interval", () => {
    const { result } = renderHook(() => useMeetNowClock());
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(MEET_NOW_TICK_MS);
    });
    expect(Temporal.Instant.compare(result.current, first)).toBeGreaterThan(0);
  });
});
