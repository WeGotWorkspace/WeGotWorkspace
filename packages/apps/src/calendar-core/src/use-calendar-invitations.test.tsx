import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_BACKGROUND_POLL_MS,
  CALENDAR_PUSH_POLL_MS,
} from "@/calendar-core/src/calendar-refresh";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import type { CalendarAPIOperations } from "@/lib/models/calendar-types";
import { useCalendarInvitations } from "@/calendar-core/src/use-calendar-invitations";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  readCalendarSchedulingInbox,
  writeCalendarSchedulingInbox,
} from "@/lib/offline/calendars/calendars-scheduling-offline-store";
import { reportCalendarsSchedulingConflicts } from "@/lib/offline/calendars/calendars-sync-conflicts";

vi.mock("@/lib/api/wgw/use-jmap-state-change", () => ({
  useJmapPushConnected: vi.fn(() => false),
  useJmapStateChange: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
}));

vi.mock("@/lib/offline/calendars/calendars-scheduling-offline-store", () => ({
  readCalendarSchedulingInbox: vi.fn(async () => []),
  writeCalendarSchedulingInbox: vi.fn(async () => undefined),
  readCalendarInviteesDirectory: vi.fn(async () => null),
  writeCalendarInviteesDirectory: vi.fn(async () => undefined),
}));

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
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(useJmapPushConnected).mockReturnValue(false);
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

  it("polls on the slow interval while push is connected (#2287)", async () => {
    vi.mocked(useJmapPushConnected).mockReturnValue(true);
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALENDAR_PUSH_POLL_MS - 1);
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);
  });

  it("refreshes invitations when a CalendarEvent state is pushed, before the slow poll", async () => {
    vi.mocked(useJmapPushConnected).mockReturnValue(true);
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    const [types, onChange] = vi.mocked(useJmapStateChange).mock.calls.at(-1)!;
    expect(types).toEqual(["CalendarEvent"]);
    await act(async () => {
      await onChange({ CalendarEvent: "s2" }, "acc");
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);
  });

  it("leaves a pushed state unconfirmed while the mount fetch is in flight", async () => {
    let releaseMount: (() => void) | undefined;
    const listSchedulingNotifications = vi.fn().mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          releaseMount = () => resolve([]);
        }),
    );
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));
    const [, onChange] = vi.mocked(useJmapStateChange).mock.calls.at(-1)!;
    let confirmed: unknown;
    await act(async () => {
      confirmed = await onChange({ CalendarEvent: "s2" }, "acc");
    });
    expect(confirmed).toBe(false);
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseMount?.();
    });
  });

  it("leaves a pushed state unconfirmed when the list fails", async () => {
    const listSchedulingNotifications = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("down"));
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const [, onChange] = vi.mocked(useJmapStateChange).mock.calls.at(-1)!;
    let confirmed: unknown;
    await act(async () => {
      confirmed = await onChange({ CalendarEvent: "s2" }, "acc");
    });
    expect(confirmed).toBe(false);
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);
  });

  it("ignores a pushed state while the document is hidden", async () => {
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    renderHook(() => useCalendarInvitations(operations));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const [, onChange] = vi.mocked(useJmapStateChange).mock.calls.at(-1)!;
    let confirmed: unknown = "unset";
    await act(async () => {
      confirmed = await onChange({ CalendarEvent: "s2" }, "acc");
    });
    expect(confirmed).toBeUndefined();
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);
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

  it("refetches immediately when refreshIfIdle runs after the mount fetch", async () => {
    const listSchedulingNotifications = vi.fn().mockResolvedValue([]);
    const operations = operationsWithList(listSchedulingNotifications);
    const { result } = renderHook(() => useCalendarInvitations(operations));

    await act(async () => {
      await Promise.resolve();
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refreshIfIdle();
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(2);
  });

  it("skips refreshIfIdle while a fetch is already in flight", async () => {
    let releaseMount: (() => void) | undefined;
    const listSchedulingNotifications = vi.fn().mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          releaseMount = () => resolve([]);
        }),
    );
    const operations = operationsWithList(listSchedulingNotifications);
    const { result } = renderHook(() => useCalendarInvitations(operations));

    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refreshIfIdle();
    });
    expect(listSchedulingNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseMount?.();
    });
  });

  it("does not keep Accepted when respond fails", async () => {
    const invite: CalendarSchedulingNotification = {
      id: "invite-1.ics",
      uid: "uid-1",
      method: "REQUEST",
      title: "Standup",
      organizerEmail: "bob@example.test",
      participationStatus: "needs-action",
    };
    const respondSchedulingNotification = vi
      .fn()
      .mockRejectedValue(new Error("Could not send RSVP"));
    const onError = vi.fn();
    const operations: CalendarAPIOperations = {
      ...operationsWithList(vi.fn().mockResolvedValue([invite])),
      respondSchedulingNotification,
    };
    const { result } = renderHook(() => useCalendarInvitations(operations, { onError }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.notifications[0]?.participationStatus).toBe("needs-action");

    await act(async () => {
      await expect(result.current.respond("invite-1.ics", "accepted")).rejects.toThrow(
        "Could not send RSVP",
      );
    });

    expect(result.current.notifications[0]?.participationStatus).toBe("needs-action");
    expect(onError).toHaveBeenCalled();
  });

  it("drops a cancelled invite reported during outbox flush", async () => {
    const invite: CalendarSchedulingNotification = {
      id: "invite-1.ics",
      uid: "uid-1",
      method: "REQUEST",
      title: "Standup",
      organizerEmail: "bob@example.test",
      participationStatus: "accepted",
    };
    const onSchedulingConflict = vi.fn();
    const operations = operationsWithList(vi.fn().mockResolvedValue([invite]));
    const { result } = renderHook(() =>
      useCalendarInvitations(operations, { onSchedulingConflict }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.notifications).toHaveLength(1);

    await act(async () => {
      reportCalendarsSchedulingConflicts(["invite-1.ics"]);
    });

    expect(result.current.notifications).toEqual([]);
    expect(onSchedulingConflict).toHaveBeenCalledWith(["invite-1.ics"]);
  });

  it("ignores empty scheduling conflict reports from clean outbox flushes", async () => {
    const onSchedulingConflict = vi.fn();
    const operations = operationsWithList(vi.fn().mockResolvedValue([]));
    renderHook(() => useCalendarInvitations(operations, { onSchedulingConflict }));

    await act(async () => {
      reportCalendarsSchedulingConflicts([]);
    });

    expect(onSchedulingConflict).not.toHaveBeenCalled();
  });

  it("applies RSVP locally while offline and skips the live inbox refresh", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const invite: CalendarSchedulingNotification = {
      id: "invite-1.ics",
      uid: "uid-1",
      method: "REQUEST",
      title: "Standup",
      organizerEmail: "bob@example.test",
      participationStatus: "needs-action",
    };
    vi.mocked(readCalendarSchedulingInbox).mockResolvedValue([invite]);
    const listSchedulingNotifications = vi.fn().mockRejectedValue(new Error("offline"));
    const respondSchedulingNotification = vi.fn().mockResolvedValue(undefined);
    const operations: CalendarAPIOperations = {
      ...operationsWithList(listSchedulingNotifications),
      respondSchedulingNotification,
    };
    const { result } = renderHook(() => useCalendarInvitations(operations, { username: "alice" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.notifications).toEqual([invite]);
    expect(listSchedulingNotifications).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.respond("invite-1.ics", "accepted");
    });

    expect(respondSchedulingNotification).toHaveBeenCalledWith(
      "invite-1.ics",
      "accepted",
      undefined,
    );
    expect(result.current.notifications[0]?.participationStatus).toBe("accepted");
    expect(listSchedulingNotifications).not.toHaveBeenCalled();
    expect(writeCalendarSchedulingInbox).toHaveBeenCalled();
  });
});
