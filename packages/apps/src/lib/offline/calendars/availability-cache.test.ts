import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { calendarsAvailabilityTable } from "@/lib/offline/calendars/calendars-schema";
import {
  AVAILABILITY_CACHE_MAX_AGE_MS,
  availabilityWeeksFromResponse,
  dropAvailabilityFor,
  evictAvailabilityWeeks,
  readAvailabilityWeeks,
  readCachedTeamMembers,
  writeAvailabilityWeeks,
  writeCachedTeamMembers,
  type AvailabilityWeek,
} from "@/lib/offline/calendars/availability-cache";
import {
  addUtcWeeks,
  mergeWeekPeriods,
  planAvailabilityCalls,
} from "@/lib/jmap-client/availability/availability-weeks";
import type { JmapBusyPeriod } from "@/lib/jmap-client/availability/types";

const viewer = "viewer";
const NOW = Date.parse("2026-11-11T08:00:00Z");

const titled: JmapBusyPeriod = {
  start: "2026-11-10T09:00:00",
  timeZone: "Europe/Amsterdam",
  duration: "PT1H",
  showWithoutTime: false,
  title: "Roadmap review",
};

function week(username: string, weekStart: string, extra: Partial<AvailabilityWeek> = {}) {
  return {
    username,
    weekStart,
    periods: [],
    complete: true,
    version: "v1",
    fetchedAt: NOW,
    ...extra,
  } satisfies AvailabilityWeek;
}

async function clearAll() {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(viewer));
  await calendarsAvailabilityTable(db).clear();
  await db.table("calendars_team_members").clear();
  await db.meta.delete("calendars:teamMembers:state");
}

describe("availability cache", () => {
  beforeEach(clearAll);

  it("allocates the availability Dexie step after scheduling", () => {
    expect(CALENDARS_OFFLINE_VERSION.scheduling).toBe(52);
    expect(CALENDARS_OFFLINE_VERSION.availability).toBe(53);
  });

  it("restores the teammates list after a reload", async () => {
    expect(await readCachedTeamMembers(viewer)).toBeNull();
    await writeCachedTeamMembers(viewer, {
      state: "s1",
      list: [
        { id: "viewer", name: "Viewer", isSelf: true, version: "a" },
        { id: "alice", name: "Alice", isSelf: false, version: "b" },
      ],
    });
    expect(await readCachedTeamMembers(viewer)).toEqual({
      state: "s1",
      list: [
        { id: "viewer", name: "Viewer", isSelf: true, version: "a" },
        { id: "alice", name: "Alice", isSelf: false, version: "b" },
      ],
    });
  });

  it("drops a person's weeks when their version changes, so titles do not linger", async () => {
    await writeAvailabilityWeeks(viewer, [
      week("alice", "2026-11-09", { periods: [titled] }),
      week("alice", "2026-11-16", { periods: [titled] }),
      week("bob", "2026-11-09"),
    ]);
    const dropped = await writeCachedTeamMembers(viewer, {
      state: "s2",
      list: [
        { id: "alice", name: "Alice", isSelf: false, version: "v2" },
        { id: "bob", name: "Bob", isSelf: false, version: "v1" },
      ],
    });
    expect(dropped).toEqual(["alice"]);
    const rows = await readAvailabilityWeeks(
      viewer,
      ["alice", "bob"],
      ["2026-11-09", "2026-11-16"],
    );
    expect(rows.map((row) => `${row.username}@${row.weekStart}`)).toEqual(["bob@2026-11-09"]);
  });

  it("drops a person's weeks when they leave the list", async () => {
    await writeAvailabilityWeeks(viewer, [week("alice", "2026-11-09"), week("bob", "2026-11-09")]);
    const dropped = await writeCachedTeamMembers(viewer, {
      state: "s3",
      list: [{ id: "bob", name: "Bob", isSelf: false, version: "v1" }],
    });
    expect(dropped).toEqual(["alice"]);
    await dropAvailabilityFor(viewer, ["bob"]);
    expect(await readAvailabilityWeeks(viewer, ["alice", "bob"], ["2026-11-09"])).toEqual([]);
  });

  it("writes every week of a run, a person's incomplete flag on all of them", () => {
    const [plan] = planAvailabilityCalls(["alice", "bob"], ["2026-11-09", "2026-11-16"]);
    const rows = availabilityWeeksFromResponse(
      plan!,
      {
        list: [
          { id: "alice", periods: [titled], complete: false },
          { id: "bob", periods: [], complete: true },
        ],
        notFound: [],
      },
      new Map([
        ["alice", "va"],
        ["bob", "vb"],
      ]),
      NOW,
    );
    expect(
      rows.map((row) => [row.username, row.weekStart, row.complete, row.periods.length]),
    ).toEqual([
      ["alice", "2026-11-09", false, 1],
      ["alice", "2026-11-16", false, 0],
      ["bob", "2026-11-09", true, 0],
      ["bob", "2026-11-16", true, 0],
    ]);
  });

  it("keeps a cross-week period busy offline in the second week and draws it once", async () => {
    const overnight: JmapBusyPeriod = {
      start: "2026-11-15T22:00:00",
      timeZone: "UTC",
      duration: "PT4H",
      showWithoutTime: false,
    };
    const [plan] = planAvailabilityCalls(["alice"], ["2026-11-09", "2026-11-16"]);
    await writeAvailabilityWeeks(
      viewer,
      availabilityWeeksFromResponse(
        plan!,
        { list: [{ id: "alice", periods: [overnight], complete: true }], notFound: [] },
        new Map([["alice", "v1"]]),
        NOW,
      ),
    );
    // Offline, looking at the second week only.
    const cached = await readAvailabilityWeeks(viewer, ["alice"], ["2026-11-16"]);
    expect(mergeWeekPeriods(cached)).toEqual([overnight]);
    // A view covering both weeks draws it once.
    const both = await readAvailabilityWeeks(viewer, ["alice"], ["2026-11-09", "2026-11-16"]);
    expect(both).toHaveLength(2);
    expect(mergeWeekPeriods(both)).toEqual([overnight]);
  });

  it("writes no row for a week outside the fetched run", async () => {
    const overnight: JmapBusyPeriod = {
      start: "2026-11-15T22:00:00",
      timeZone: "UTC",
      duration: "PT4H",
      showWithoutTime: false,
    };
    const [plan] = planAvailabilityCalls(["alice"], ["2026-11-09"]);
    await writeAvailabilityWeeks(
      viewer,
      availabilityWeeksFromResponse(
        plan!,
        { list: [{ id: "alice", periods: [overnight], complete: true }], notFound: [] },
        new Map([["alice", "v1"]]),
        NOW,
      ),
    );
    // The next week was never fetched, so it stays missing rather than empty.
    expect(await readAvailabilityWeeks(viewer, ["alice"], ["2026-11-16"])).toEqual([]);
  });

  it("evicts old weeks outside the prefetch window, keeps the window", async () => {
    const old = NOW - AVAILABILITY_CACHE_MAX_AGE_MS - 1;
    await writeAvailabilityWeeks(viewer, [
      week("alice", "2026-01-05", { fetchedAt: old }),
      week("alice", "2026-11-09", { fetchedAt: old }),
      week("alice", "2026-03-02", { fetchedAt: NOW - 1000 }),
    ]);
    const evicted = await evictAvailabilityWeeks(viewer, { now: NOW, keepWeeks: ["2026-11-09"] });
    expect(evicted).toBe(1);
    const rows = await readAvailabilityWeeks(
      viewer,
      ["alice"],
      ["2026-01-05", "2026-03-02", "2026-11-09"],
    );
    expect(rows.map((row) => row.weekStart)).toEqual(["2026-03-02", "2026-11-09"]);
  });

  it("keeps at most 60 weeks per person, dropping the oldest fetches first", async () => {
    const rows = Array.from({ length: 63 }, (_, index) =>
      week("alice", addUtcWeeks("2025-01-06", index), { fetchedAt: NOW - (63 - index) * 1000 }),
    );
    await writeAvailabilityWeeks(viewer, [...rows, week("bob", "2026-11-09")]);
    await evictAvailabilityWeeks(viewer, { now: NOW, keepWeeks: [] });
    const left = await readAvailabilityWeeks(
      viewer,
      ["alice", "bob"],
      [...rows.map((row) => row.weekStart), "2026-11-09"],
    );
    const alice = left.filter((row) => row.username === "alice").map((row) => row.weekStart);
    expect(alice).toHaveLength(60);
    expect(alice).not.toContain("2025-01-06");
    expect(alice).not.toContain("2025-01-20");
    expect(alice).toContain("2025-01-27");
    expect(left.some((row) => row.username === "bob")).toBe(true);
  });
});
