import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const flush = vi.fn();
vi.mock("@/lib/offline/calendars-offline-store", () => ({
  listFailedCalendarOutbox: vi.fn(),
}));
vi.mock("@/lib/offline/calendars-hybrid-operations", () => ({
  getCalendarsSyncRunner: () => ({ flush }),
}));

import { defaultCalendarLabels as L } from "@/calendar-core/src/calendar-labels";
import { useCalendarSyncNotice } from "@/calendar-core/src/use-calendar-sync-notice";
import { listFailedCalendarOutbox } from "@/lib/offline/calendars-offline-store";

const failedRow = {
  id: "a",
  domain: "calendars",
  op: "create",
  payload: "{}",
  createdAt: 1,
  retries: 2,
  lastError: "Failed to fetch JMAP session (502)",
  lastStatus: 502,
};

describe("useCalendarSyncNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    flush.mockImplementation(async () => {
      calls.push("flush");
    });
  });

  function reloadFromCache() {
    return vi.fn(async () => {
      calls.push("reload");
    });
  }

  it("shows nothing while nothing failed", async () => {
    vi.mocked(listFailedCalendarOutbox).mockResolvedValue([]);
    const { result } = renderHook(() =>
      useCalendarSyncNotice({ username: "member", labels: L, reloadFromCache: reloadFromCache() }),
    );
    await waitFor(() => expect(listFailedCalendarOutbox).toHaveBeenCalledWith("member"));
    expect(result.current).toBeNull();
  });

  it("shows nothing without a signed-in user", async () => {
    vi.mocked(listFailedCalendarOutbox).mockResolvedValue([failedRow]);
    const { result } = renderHook(() =>
      useCalendarSyncNotice({ username: null, labels: L, reloadFromCache: reloadFromCache() }),
    );
    await act(async () => undefined);
    expect(result.current).toBeNull();
    expect(listFailedCalendarOutbox).not.toHaveBeenCalled();
  });

  it("Retry flushes, then rereads the cache, then recounts, and the row clears", async () => {
    vi.mocked(listFailedCalendarOutbox).mockResolvedValue([failedRow]);
    const reload = reloadFromCache();
    const { result } = renderHook(() =>
      useCalendarSyncNotice({ username: "member", labels: L, reloadFromCache: reload }),
    );
    await waitFor(() => expect(result.current?.title).toBe(L.syncFailedNotice));
    expect(result.current?.id).toBe("sync:calendar");
    expect(result.current?.actionLabel).toBe(L.retrySync);

    vi.mocked(listFailedCalendarOutbox).mockImplementation(async () => {
      calls.push("recount");
      return [];
    });
    act(() => result.current!.onAction());
    await waitFor(() => expect(result.current).toBeNull());
    expect(calls.slice(0, 3)).toEqual(["flush", "reload", "recount"]);
    expect(flush).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the row, and rereads the cache, when the flush fails again", async () => {
    vi.mocked(listFailedCalendarOutbox).mockResolvedValue([failedRow]);
    flush.mockRejectedValue(new Error("offline"));
    const reload = reloadFromCache();
    const { result } = renderHook(() =>
      useCalendarSyncNotice({ username: "member", labels: L, reloadFromCache: reload }),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.onAction());
    await waitFor(() => expect(result.current?.actionDisabled).toBe(true));
    await waitFor(() => expect(result.current?.actionDisabled).toBe(false));
    expect(result.current?.title).toBe(L.syncFailedNotice);
    expect(reload).toHaveBeenCalledOnce();
  });
});
