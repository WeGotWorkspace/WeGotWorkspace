import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  ingestRemoteCalendarEvent,
  ingestRemoteCalendarEventDestroyed,
} from "@/lib/offline/calendars-jmap-inbound";

const listPending = vi.fn<() => Promise<string[]>>();
const upsert = vi.fn();
const remove = vi.fn();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/calendars-offline-store", () => ({
  listPendingCalendarEventIds: () => listPending(),
  upsertCalendarEventInCache: (...args: unknown[]) => upsert(...args),
  removeCalendarEventFromCache: (...args: unknown[]) => remove(...args),
}));

vi.mock("@/lib/offline/calendars-sync-conflicts", () => ({
  reportCalendarsSyncConflicts: (...args: unknown[]) => reportConflicts(...args),
}));

const remote: JmapCalendarEvent = {
  "@type": "Event",
  id: "ev-1",
  uid: "urn:uuid:ev-1",
  title: "Remote",
  start: "2033-01-10T10:00:00",
  calendarIds: { work: true },
} as JmapCalendarEvent;

describe("calendars-jmap-inbound", () => {
  beforeEach(() => {
    listPending.mockReset();
    upsert.mockReset();
    remove.mockReset();
    reportConflicts.mockReset();
    listPending.mockResolvedValue([]);
  });

  it("upserts a remote create/update into Dexie when the id is not pending", async () => {
    await expect(ingestRemoteCalendarEvent("ada", remote)).resolves.toBe("upserted");
    expect(upsert).toHaveBeenCalledWith("ada", remote, false, false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("skips a pending local row and reports the conflict channel", async () => {
    listPending.mockResolvedValue(["ev-1"]);
    await expect(ingestRemoteCalendarEvent("ada", remote)).resolves.toBe("skipped-pending");
    expect(upsert).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["ev-1"]);
  });

  it("removes a remotely destroyed event that is not pending", async () => {
    await expect(ingestRemoteCalendarEventDestroyed("ada", "ev-1")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "ev-1");
  });

  it("does not remove a pending local row on remote destroy", async () => {
    listPending.mockResolvedValue(["ev-1"]);
    await expect(ingestRemoteCalendarEventDestroyed("ada", "ev-1")).resolves.toBe(
      "skipped-pending",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["ev-1"]);
  });
});
