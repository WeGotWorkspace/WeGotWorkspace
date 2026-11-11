import { describe, expect, it } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  formatAvailabilityAge,
  teamAvailabilityOfflineNotice,
} from "@/calendar-core/src/calendar-availability-notice";

const NOW = Date.parse("2026-11-11T08:00:00Z");
const base = { now: NOW, locale: "en", labels: defaultCalendarLabels };

describe("team availability offline notice", () => {
  it("is gone online or with nobody ticked", () => {
    const coverage = { oldestFetchedAt: NOW, uncachedWeeks: true };
    expect(
      teamAvailabilityOfflineNotice({ ...base, online: true, shownCount: 2, coverage }),
    ).toBeNull();
    expect(
      teamAvailabilityOfflineNotice({ ...base, online: false, shownCount: 0, coverage }),
    ).toBeNull();
  });

  it("states the age of the oldest week in view", () => {
    const notice = teamAvailabilityOfflineNotice({
      ...base,
      online: false,
      shownCount: 1,
      coverage: { oldestFetchedAt: NOW - 5 * 60 * 1000, uncachedWeeks: false },
    });
    expect(notice).toMatchObject({ tone: "info" });
    expect(notice?.title).toBe("Offline · teammates' availability updated 5 minutes ago.");
    expect(notice?.actionLabel).toBeUndefined();
  });

  it("adds the uncached sentence when a week in view was never fetched", () => {
    const notice = teamAvailabilityOfflineNotice({
      ...base,
      online: false,
      shownCount: 1,
      coverage: { oldestFetchedAt: NOW - 2 * 60 * 60 * 1000, uncachedWeeks: true },
    });
    expect(notice?.title).toBe(
      "Offline · teammates' availability updated 2 hours ago. Some weeks in view are not available offline.",
    );
  });

  it("says nothing is available when no week in view is cached", () => {
    const notice = teamAvailabilityOfflineNotice({
      ...base,
      online: false,
      shownCount: 1,
      coverage: { oldestFetchedAt: null, uncachedWeeks: true },
    });
    expect(notice?.title).toBe(
      "Offline · teammates' availability for this period is not available offline.",
    );
  });

  it("formats ages", () => {
    expect(formatAvailabilityAge(NOW - 10_000, NOW, "en", "just now")).toBe("just now");
    expect(formatAvailabilityAge(NOW - 3 * 24 * 60 * 60 * 1000, NOW, "en", "just now")).toBe(
      "3 days ago",
    );
  });
});
