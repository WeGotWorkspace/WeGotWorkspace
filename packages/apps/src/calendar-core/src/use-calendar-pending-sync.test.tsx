import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar-engine";

vi.mock("@/lib/offline/calendars-offline-store", () => ({
  listPendingCalendarEventIds: vi.fn(),
}));

import { listPendingCalendarEventIds } from "@/lib/offline/calendars-offline-store";
import {
  applyPendingSyncToEngineEvents,
  useCalendarPendingSync,
} from "@/calendar-core/src/use-calendar-pending-sync";

describe("useCalendarPendingSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty set and skips the read when no username is known", () => {
    const { result } = renderHook(() => useCalendarPendingSync(null));
    expect(result.current.size).toBe(0);
    expect(listPendingCalendarEventIds).not.toHaveBeenCalled();
  });

  it("exposes the pending event ids read from the offline store", async () => {
    vi.mocked(listPendingCalendarEventIds).mockResolvedValue(["ev-1", "ev-2"]);
    const { result } = renderHook(() => useCalendarPendingSync("bob"));

    await waitFor(() => expect(result.current.has("ev-1")).toBe(true));
    expect(result.current.has("ev-2")).toBe(true);
    expect(result.current.size).toBe(2);
  });
});

describe("applyPendingSyncToEngineEvents", () => {
  it("stamps pendingOp on matching engine events", () => {
    const event = {
      eventId: "ev-1",
      calendarId: "work",
      data: { summary: "Standup", start: { toString: () => "2033-01-10T10:00:00" } },
    } as unknown as CalendarEvent;
    const map = new Map<string, CalendarEvent>([["ev-1", event]]);

    const next = applyPendingSyncToEngineEvents(map, new Set(["ev-1"]));
    expect(next.get("ev-1")?.pendingOp).toBe("updated");
  });
});
