import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_SPIN_CYCLE_MS } from "@/refresh-spin/src/refresh-spin";
import { useRefreshSpin } from "@/refresh-spin/src/use-refresh-spin";

describe("useRefreshSpin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps spinning for a full cycle when active clears early", () => {
    const { result, rerender } = renderHook(({ active }) => useRefreshSpin(active), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ active: false });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(REFRESH_SPIN_CYCLE_MS - 200 - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("stops on a cycle boundary when active clears after multiple turns", () => {
    const { result, rerender } = renderHook(({ active }) => useRefreshSpin(active), {
      initialProps: { active: true },
    });

    act(() => {
      vi.advanceTimersByTime(REFRESH_SPIN_CYCLE_MS + 250);
    });
    rerender({ active: false });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(REFRESH_SPIN_CYCLE_MS - 250 - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("stays spinning while active remains true past one cycle", () => {
    const { result } = renderHook(() => useRefreshSpin(true));
    act(() => {
      vi.advanceTimersByTime(REFRESH_SPIN_CYCLE_MS * 3);
    });
    expect(result.current).toBe(true);
  });
});
