import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEAM_AVAILABILITY_TICK_MS,
  useTeamAvailability,
  type TeamAvailabilitySource,
  type UseTeamAvailabilityArgs,
} from "@/calendar-core/src/use-team-availability";
import { CALENDAR_VIEW_PREFS_STORAGE_KEY } from "@/calendar-core/src/calendar-view-prefs";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readAvailabilityWeeks,
  writeAvailabilityWeeks,
  writeCachedTeamMembers,
} from "@/lib/offline/calendars/availability-cache";
import type {
  JmapTeamMember,
  JmapTeamMemberGetAvailabilityArgs,
} from "@/lib/jmap-client/availability/types";

const viewer = "viewer";
// Wednesday 11 Nov 2026, 08:00 UTC.
const NOW = Date.parse("2026-11-11T08:00:00Z");

const member = (id: string, version = "v1", isSelf = false): JmapTeamMember => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  isSelf,
  version,
});

function fakeSource(initial: JmapTeamMember[]) {
  let list = initial;
  let state = "s1";
  const getAvailability = vi.fn(async (args: JmapTeamMemberGetAvailabilityArgs) => ({
    list: args.ids.map((id) => ({
      id,
      complete: id !== "carol",
      periods: [
        {
          start: args.utcStart.replace("T00:00:00Z", "T09:00:00"),
          timeZone: "Europe/Amsterdam",
          duration: "PT1H",
          showWithoutTime: false,
        },
      ],
    })),
    notFound: [],
  }));
  const source = {
    getTeamMembers: vi.fn(async () => ({ state, list, notFound: [] })),
    getAvailability,
  } satisfies TeamAvailabilitySource;
  return {
    source,
    getAvailability,
    setMembers(next: JmapTeamMember[], nextState: string) {
      list = next;
      state = nextState;
    },
  };
}

async function resetDb() {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(viewer));
  await db.table("calendars_availability").clear();
  await db.table("calendars_team_members").clear();
  await db.meta.delete("calendars:teamMembers:state");
}

function shown(ids: string[]) {
  window.localStorage.setItem(
    CALENDAR_VIEW_PREFS_STORAGE_KEY,
    JSON.stringify({ shownAvailabilityIds: ids }),
  );
}

function renderAvailability(
  initial: Partial<UseTeamAvailabilityArgs> & { source?: TeamAvailabilitySource },
) {
  return renderHook((props: Partial<UseTeamAvailabilityArgs>) =>
    useTeamAvailability({
      viewer,
      view: "week",
      anchor: "2026-11-11",
      online: true,
      now: () => NOW,
      ...initial,
      ...props,
    }),
  );
}

describe("useTeamAvailability", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetDb();
  });

  it("keeps its own 60-second tick, separate from the 10-second calendar poll", () => {
    expect(TEAM_AVAILABILITY_TICK_MS).toBe(60_000);
    expect(CALENDAR_BACKGROUND_POLL_MS).toBe(10_000);
  });

  it("lists teammates hidden by default and fetches nobody", async () => {
    const { source, getAvailability } = fakeSource([member("alice"), member("me", "v1", true)]);
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.members).not.toBeNull());
    expect(result.current.members!.map((entry) => entry.id)).toEqual(["me", "alice"]);
    expect(result.current.shownIds.size).toBe(0);
    expect(getAvailability).not.toHaveBeenCalled();
    expect(result.current.overlayEvents.size).toBe(0);
  });

  it("fetches only ticked teammates, the weeks in view plus the prefetch window", async () => {
    shown(["alice"]);
    const { source, getAvailability } = fakeSource([member("alice"), member("bob")]);
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.overlayEvents.size).toBeGreaterThan(0));
    const calls = getAvailability.mock.calls.map(([args]) => args);
    expect(calls.every((args) => args.ids.join() === "alice")).toBe(true);
    // Visible week (9 Nov, padded) and current week + 4 merge into one run.
    expect(calls[0]).toMatchObject({
      utcStart: "2026-11-02T00:00:00Z",
      utcEnd: "2026-12-14T00:00:00Z",
    });
  });

  it("gives colliding teammates distinct colours that ticking never changes", async () => {
    // ada, grace and member share the violet avatar colour; alan is sky.
    shown(["ada", "grace", "member"]);
    const team = ["member", "grace", "alan", "ada"].map((id) => member(id));
    const { source } = fakeSource(team);
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.overlayEvents.size).toBeGreaterThan(0));
    const before = new Map(result.current.colors);
    expect(new Set(before.values()).size).toBe(4);
    expect(before.get("ada")).toBe("violet");

    act(() => result.current.toggleShown("ada"));
    await waitFor(() => expect(result.current.shownIds.has("ada")).toBe(false));
    expect(new Map(result.current.colors)).toEqual(before);
    const graceBlock = [...result.current.overlayEvents.values()].find(
      (event) => event.calendarId === "availability:grace",
    );
    expect(graceBlock?.data.color).toBe("#f43f5e");
  });

  it("shows or hides several teammates at once and remembers it", async () => {
    shown(["ada", "gone"]);
    const { source } = fakeSource(["ada", "alan", "grace"].map((id) => member(id)));
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.members).not.toBeNull());
    act(() => result.current.setShown(["ada", "alan", "grace"], true));
    expect([...result.current.shownIds].sort()).toEqual(["ada", "alan", "gone", "grace"]);
    act(() => result.current.setShown(["ada", "alan", "grace"], false));
    expect([...result.current.shownIds]).toEqual(["gone"]);
    expect(JSON.parse(window.localStorage.getItem(CALENDAR_VIEW_PREFS_STORAGE_KEY)!)).toMatchObject(
      { shownAvailabilityIds: ["gone"] },
    );
  });

  it("fetches the visible range at once when ticking a teammate", async () => {
    const { source, getAvailability } = fakeSource([member("alice")]);
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.members).not.toBeNull());
    act(() => result.current.toggleShown("alice"));
    await waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(1));
    expect(getAvailability.mock.calls[0]![0]).toMatchObject({
      ids: ["alice"],
      utcStart: "2026-11-02T00:00:00Z",
      utcEnd: "2026-11-23T00:00:00Z",
    });
    expect(JSON.parse(window.localStorage.getItem(CALENDAR_VIEW_PREFS_STORAGE_KEY)!)).toMatchObject(
      {
        shownAvailabilityIds: ["alice"],
      },
    );
  });

  it("a jump to next year fetches at once, in one call per batch", async () => {
    const twelve = Array.from({ length: 12 }, (_, index) => member(`user${index + 10}`));
    shown(twelve.map((entry) => entry.id));
    const { source, getAvailability } = fakeSource(twelve);
    const { result, rerender } = renderAvailability({ source });
    await waitFor(() => expect(result.current.overlayEvents.size).toBeGreaterThan(0));
    getAvailability.mockClear();
    rerender({ view: "year", anchor: "2027-06-01" });
    await waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(2));
    for (const [args] of getAvailability.mock.calls) {
      expect(args.utcStart).toBe("2026-12-28T00:00:00Z");
      expect(args.utcEnd).toBe("2028-01-03T00:00:00Z");
    }
    expect(getAvailability.mock.calls.flatMap(([args]) => args.ids)).toHaveLength(12);
  });

  it("re-checks the team list, the view and the prefetch window on every tick", async () => {
    shown(["alice"]);
    const { source, getAvailability } = fakeSource([member("alice")]);
    // A short tick stands in for the 60 seconds asserted above.
    const { result } = renderAvailability({ source, tickMs: 150 });
    await waitFor(() => expect(result.current.overlayEvents.size).toBeGreaterThan(0));
    const before = getAvailability.mock.calls.length;
    await waitFor(() => expect(source.getTeamMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getAvailability.mock.calls.length).toBeGreaterThan(before));
    expect(getAvailability.mock.calls.at(-1)![0]).toMatchObject({
      utcStart: "2026-11-02T00:00:00Z",
      utcEnd: "2026-12-14T00:00:00Z",
    });
  });

  it("drops a teammate's cached weeks when their version changes on the tick", async () => {
    shown(["alice"]);
    await writeCachedTeamMembers(viewer, { state: "s1", list: [member("alice")] });
    await writeAvailabilityWeeks(viewer, [
      {
        username: "alice",
        weekStart: "2027-03-01",
        periods: [
          {
            start: "2027-03-02T09:00:00",
            timeZone: null,
            duration: "PT1H",
            showWithoutTime: false,
            title: "Secret",
          },
        ],
        complete: true,
        version: "v1",
        fetchedAt: NOW,
      },
    ]);
    const fake = fakeSource([member("alice")]);
    const { result } = renderAvailability({ source: fake.source, tickMs: 150 });
    await waitFor(() => expect(result.current.overlayEvents.size).toBeGreaterThan(0));
    expect(await readAvailabilityWeeks(viewer, ["alice"], ["2027-03-01"])).toHaveLength(1);
    fake.setMembers([member("alice", "v2")], "s2");
    await waitFor(async () =>
      expect(await readAvailabilityWeeks(viewer, ["alice"], ["2027-03-01"])).toEqual([]),
    );
  });

  it("a cross-week period stays busy offline, and the notice says what is missing", async () => {
    shown(["alice"]);
    await writeCachedTeamMembers(viewer, { state: "s1", list: [member("alice")] });
    await writeAvailabilityWeeks(viewer, [
      {
        username: "alice",
        weekStart: "2026-11-16",
        periods: [
          {
            start: "2026-11-15T22:00:00Z",
            timeZone: null,
            duration: "PT4H",
            showWithoutTime: false,
          },
        ],
        complete: true,
        version: "v1",
        fetchedAt: NOW - 5 * 60 * 1000,
      },
    ]);
    const { source, getAvailability } = fakeSource([member("alice")]);
    const { result } = renderAvailability({ source, online: false, anchor: "2026-11-18" });
    await waitFor(() => expect(result.current.overlayEvents.size).toBe(1));
    expect(getAvailability).not.toHaveBeenCalled();
    expect(source.getTeamMembers).not.toHaveBeenCalled();
    // The week of 16 Nov needs 9, 16 and 23 Nov; only 16 Nov is cached.
    expect(result.current.coverage).toEqual({
      oldestFetchedAt: NOW - 5 * 60 * 1000,
      uncachedWeeks: true,
    });
  });

  it("marks a teammate whose weeks came back incomplete", async () => {
    shown(["carol", "alice"]);
    const { source } = fakeSource([member("alice"), member("carol")]);
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(result.current.incompleteIds.has("carol")).toBe(true));
    expect(result.current.incompleteIds.has("alice")).toBe(false);
  });

  it("shows no section when the server lacks the capability", async () => {
    const source: TeamAvailabilitySource = {
      getTeamMembers: vi.fn(async () => null),
      getAvailability: vi.fn(),
    };
    const { result } = renderAvailability({ source });
    await waitFor(() => expect(source.getTeamMembers).toHaveBeenCalled());
    expect(result.current.members).toBeNull();
  });
});
