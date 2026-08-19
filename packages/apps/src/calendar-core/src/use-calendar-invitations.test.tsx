import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import { useCalendarInvitations } from "@/calendar-core/src/use-calendar-invitations";

function operationsWithList(
  listSchedulingNotifications: CalendarAPIOperations["listSchedulingNotifications"],
): CalendarAPIOperations {
  return {
    createEvent: vi.fn(),
    patchEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listSchedulingNotifications,
  };
}

describe("useCalendarInvitations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls scheduling notifications on the background interval", async () => {
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));

    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS);
    });

    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);
  });

  it("skips background polls while the document is hidden", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));

    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS * 2);
    });

    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);
  });

  it("does not start a second poll while one is in flight", async () => {
    let releasePoll: (() => void) | undefined;
    const listSchedulingNotifications = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation(
        () =>
          new Promise<[]>((resolve) => {
            releasePoll = () => resolve([]);
          }),
      );
    const operations = operationsWithList(listSchedulingNotifications);
    const { unmount } = renderHook(() => useCalendarInvitations(operations));

    await act(async () => {
      await Promise.resolve();
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS);
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_BACKGROUND_POLL_MS);
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);

    await act(async () => {
      releasePoll?.();
    });
    unmount();
  });
});
