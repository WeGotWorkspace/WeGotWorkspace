import { describe, expect, it, vi } from "vitest";
import {
  reportCalendarsSchedulingConflicts,
  reportCalendarsSyncConflicts,
  setCalendarsSchedulingConflictListener,
  setCalendarsSyncConflictListener,
} from "@/lib/offline/calendars-sync-conflicts";

describe("calendars sync conflicts", () => {
  it("reports event ids to the active listener", () => {
    const listener = vi.fn();
    setCalendarsSyncConflictListener(listener);
    reportCalendarsSyncConflicts(["ev-1"]);
    expect(listener).toHaveBeenCalledWith(["ev-1"]);
    setCalendarsSyncConflictListener(undefined);
  });

  it("reports cancelled invitation ids on the scheduling channel", () => {
    const listener = vi.fn();
    setCalendarsSchedulingConflictListener(listener);
    reportCalendarsSchedulingConflicts(["invite-1.ics"]);
    expect(listener).toHaveBeenCalledWith(["invite-1.ics"]);
    setCalendarsSchedulingConflictListener(undefined);
  });
});
