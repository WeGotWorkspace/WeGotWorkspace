import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import {
  mergeCalendarRangeIntoCache,
  readCalendarBootstrapFromCache,
  removeCalendarEventFromCache,
  upsertCalendarEventInCache,
  upsertSnapshotCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars/calendars-offline-store";
import { calendarsEventsTable } from "@/lib/offline/calendars/calendars-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";

const username = "alice";

function wireEvent(id: string): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: `urn:uuid:${id}`,
    calendarIds: { default: true },
    title: "Standup",
    start: "2033-01-10T10:00:00",
    duration: "PT30M",
    timeZone: "Etc/UTC",
  } as JmapCalendarEvent;
}

const bootstrap = {
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username },
  },
  data: {
    calendars: [
      {
        id: "default",
        name: "Personal",
        color: "#6366f1",
        isDefault: true,
        mayWrite: true,
        mayShare: true,
        shareWith: {
          bob: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
        },
      },
    ],
    events: [wireEvent("ev-1")],
    groups: [
      { slug: "engineering", displayName: "Engineering" },
      { slug: "design", displayName: "Design" },
    ],
  },
} satisfies CalendarAppBootstrap;

describe("calendars offline store groups", () => {
  beforeEach(async () => {
    await writeCalendarBootstrapToCache(username, bootstrap);
  });

  it("allocates the groups Dexie step at 51", () => {
    expect(CALENDARS_OFFLINE_VERSION.tables).toBe(50);
    expect(CALENDARS_OFFLINE_VERSION.groups).toBe(51);
  });

  it("restores mayWrite, mayShare, and shareWith on cached calendars", async () => {
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.calendars[0]).toMatchObject({
      mayWrite: true,
      mayShare: true,
      shareWith: {
        bob: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
      },
    });
  });

  it("restores the last group directory after a cache write", async () => {
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.groups).toEqual([
      { slug: "engineering", displayName: "Engineering" },
      { slug: "design", displayName: "Design" },
    ]);
  });

  it("preserves a just-flushed local write when live bootstrap is still stale", async () => {
    await upsertCalendarEventInCache(
      username,
      { ...wireEvent("ev-flushed"), title: "Created" },
      false,
    );

    await writeCalendarBootstrapToCache(username, bootstrap);

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "ev-flushed")?.title).toBe("Created");
    expect(cached?.data.events.some((event) => event.id === "ev-1")).toBe(true);
  });

  it("preserves pendingSync events when bootstrap is rewritten from server", async () => {
    await upsertCalendarEventInCache(
      username,
      { ...wireEvent("ev-1"), title: "Offline edit" },
      true,
    );

    await writeCalendarBootstrapToCache(username, bootstrap);

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "ev-1")?.title).toBe("Offline edit");
  });

  it("replaces groups on the next bootstrap write", async () => {
    await writeCalendarBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        groups: [{ slug: "ops", displayName: "Ops" }],
      },
    });

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.groups).toEqual([{ slug: "ops", displayName: "Ops" }]);
  });
});

describe("calendars offline store: periods outside the bootstrap window (#1675)", () => {
  const liveWindow = {
    utcStart: new Date("2025-10-01T00:00:00Z"),
    utcEnd: new Date("2028-10-01T00:00:00Z"),
  };
  const farWeek = {
    utcStart: new Date("2033-01-03T00:00:00Z"),
    utcEnd: new Date("2033-01-24T00:00:00Z"),
  };
  const at = (id: string, start: string, title = "Standup") => ({
    ...wireEvent(id),
    title,
    start,
  });
  const ids = async () =>
    ((await readCalendarBootstrapFromCache(username))?.data.events ?? []).map((event) => event.id);
  const inWindow = at("ev-now", "2026-11-04T10:00:00");

  beforeEach(async () => {
    await calendarsEventsTable(
      offlineDbForAccount(offlineAccountKeyFromUsername(username)),
    ).clear();
    await writeCalendarBootstrapToCache(username, {
      ...bootstrap,
      data: { ...bootstrap.data, events: [inWindow] },
    });
  });

  it("keeps an event outside the live window when the bootstrap is written again", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [at("ev-far", "2033-01-12T10:00:00")]);

    await writeCalendarBootstrapToCache(
      username,
      { ...bootstrap, data: { ...bootstrap.data, events: [inWindow] } },
      { window: liveWindow },
    );

    expect(await ids()).toEqual(expect.arrayContaining(["ev-now", "ev-far"]));
  });

  it("keeps a UTC event with a Z start outside the live window", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [
      { ...at("ev-far-utc", "2033-01-12T10:00:00Z"), timeZone: null },
    ]);

    await writeCalendarBootstrapToCache(
      username,
      { ...bootstrap, data: { ...bootstrap.data, events: [inWindow] } },
      { window: liveWindow },
    );

    expect(await ids()).toEqual(expect.arrayContaining(["ev-now", "ev-far-utc"]));
  });

  it("still drops an event inside the live window that the server no longer has", async () => {
    await writeCalendarBootstrapToCache(
      username,
      { ...bootstrap, data: { ...bootstrap.data, events: [] } },
      { window: liveWindow },
    );

    expect(await ids()).not.toContain("ev-now");
  });

  it("merges a loaded period and drops events in it the server no longer has", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [
      at("ev-far-gone", "2033-01-12T09:00:00"),
      at("ev-far-kept", "2033-01-13T09:00:00", "Old title"),
    ]);

    await mergeCalendarRangeIntoCache(username, farWeek, [
      at("ev-far-kept", "2033-01-13T09:00:00", "New title"),
    ]);

    const cached = await readCalendarBootstrapFromCache(username);
    const events = cached?.data.events ?? [];
    expect(events.map((event) => event.id)).toEqual(
      expect.arrayContaining(["ev-now", "ev-far-kept"]),
    );
    expect(events.some((event) => event.id === "ev-far-gone")).toBe(false);
    expect(events.find((event) => event.id === "ev-far-kept")?.title).toBe("New title");
  });

  it("keeps a pending offline edit in a loaded period", async () => {
    await upsertCalendarEventInCache(username, at("ev-far", "2033-01-12T10:00:00", "Mine"), true);

    await mergeCalendarRangeIntoCache(username, farWeek, [
      at("ev-far", "2033-01-12T10:00:00", "Server"),
    ]);
    await mergeCalendarRangeIntoCache(username, farWeek, []);

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "ev-far")?.title).toBe("Mine");
  });

  const recurring = (id: string, start: string, rule: Record<string, unknown>) =>
    ({
      ...at(id, start),
      recurrenceRules: [{ "@type": "RecurrenceRule", ...rule }],
    }) as JmapCalendarEvent;
  const liveWrite = (events: JmapCalendarEvent[], calendars = bootstrap.data.calendars) =>
    writeCalendarBootstrapToCache(
      username,
      { ...bootstrap, data: { ...bootstrap.data, calendars, events } },
      { window: liveWindow },
    );

  it("keeps a monthly series that a far-week merge omits (no occurrence that week)", async () => {
    // Loaded with an earlier period; it recurs on the 28th, not in the far week.
    await mergeCalendarRangeIntoCache(username, farWeek, [
      recurring("ev-monthly", "2032-12-28T09:00:00", { frequency: "monthly" }),
      at("ev-far-gone", "2033-01-12T09:00:00"),
    ]);

    await mergeCalendarRangeIntoCache(username, farWeek, []);

    const cachedIds = await ids();
    expect(cachedIds).toContain("ev-monthly");
    expect(cachedIds).not.toContain("ev-far-gone");
  });

  it("drops a weekly series that a far-week merge omits while it occurs that week", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [
      recurring("ev-weekly", "2033-01-11T09:00:00", { frequency: "weekly" }),
    ]);
    expect(await ids()).toContain("ev-weekly");

    await mergeCalendarRangeIntoCache(username, farWeek, []);

    expect(await ids()).not.toContain("ev-weekly");
  });

  it("keeps a count-only series that ended before the window on a live write", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [
      recurring("ev-old-series", "2020-01-08T09:00:00", { frequency: "weekly", count: 10 }),
    ]);

    await liveWrite([inWindow]);

    expect(await ids()).toContain("ev-old-series");
  });

  it("drops a series the live window omits although it occurs in that window", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [
      recurring("ev-weekly", "2020-01-08T09:00:00", { frequency: "weekly" }),
    ]);

    await liveWrite([inWindow]);

    expect(await ids()).not.toContain("ev-weekly");
  });

  it("drops events outside the window whose calendar the live snapshot no longer has", async () => {
    await mergeCalendarRangeIntoCache(username, farWeek, [at("ev-far", "2033-01-12T10:00:00")]);

    await liveWrite([], []);

    expect(await ids()).toEqual([]);
  });
});

describe("calendars offline store: a snapshot that is older than the cache (#2256)", () => {
  const liveWindow = {
    utcStart: new Date("2025-10-01T00:00:00Z"),
    utcEnd: new Date("2028-10-01T00:00:00Z"),
  };
  const week = {
    utcStart: new Date("2026-11-02T00:00:00Z"),
    utcEnd: new Date("2026-11-09T00:00:00Z"),
  };
  const at = (id: string, title = "Standup") => ({
    ...wireEvent(id),
    title,
    start: "2026-11-04T10:00:00",
  });
  const events = async () =>
    new Map(
      ((await readCalendarBootstrapFromCache(username))?.data.events ?? []).map((event) => [
        event.id,
        event.title,
      ]),
    );
  const snapshot = (list: JmapCalendarEvent[]) => ({
    ...bootstrap,
    data: { ...bootstrap.data, events: list },
  });
  /** What inbound sync does with a created or changed event. */
  const ingest = (event: JmapCalendarEvent) =>
    upsertCalendarEventInCache(username, event, false, false);
  /** A snapshot is requested, then the server and the cache move on. */
  const requestSnapshot = async () => {
    const requestedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return requestedAt;
  };

  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await calendarsEventsTable(db).clear();
    await writeCalendarBootstrapToCache(username, snapshot([at("ev-old", "Old")]), {
      window: liveWindow,
      requestedAt: Date.now() - 60_000,
    });
  });

  it("first load: keeps an event stored after the snapshot was requested", async () => {
    const requestedAt = await requestSnapshot();
    await ingest(at("ev-new", "Arrived meanwhile"));

    await writeCalendarBootstrapToCache(username, snapshot([at("ev-old", "Old")]), {
      window: liveWindow,
      requestedAt,
    });

    expect((await events()).get("ev-new")).toBe("Arrived meanwhile");
  });

  it("first load: keeps a change stored after the snapshot was requested", async () => {
    const requestedAt = await requestSnapshot();
    await ingest(at("ev-old", "Renamed meanwhile"));

    await writeCalendarBootstrapToCache(username, snapshot([at("ev-old", "Old")]), {
      window: liveWindow,
      requestedAt,
    });

    expect((await events()).get("ev-old")).toBe("Renamed meanwhile");
  });

  it("first load: does not bring back an event removed after the snapshot was requested", async () => {
    const requestedAt = await requestSnapshot();
    await removeCalendarEventFromCache(username, "ev-old");

    await writeCalendarBootstrapToCache(username, snapshot([at("ev-old", "Old")]), {
      window: liveWindow,
      requestedAt,
    });

    expect((await events()).has("ev-old")).toBe(false);
  });

  it("first load: an older snapshot written after a newer one changes nothing", async () => {
    const older = await requestSnapshot();
    const newer = await requestSnapshot();
    await writeCalendarBootstrapToCache(
      username,
      snapshot([at("ev-old", "Renamed"), at("ev-new", "New")]),
      { window: liveWindow, requestedAt: newer },
    );

    await writeCalendarBootstrapToCache(username, snapshot([at("ev-old", "Old")]), {
      window: liveWindow,
      requestedAt: older,
    });

    expect([...(await events())]).toEqual(
      expect.arrayContaining([
        ["ev-old", "Renamed"],
        ["ev-new", "New"],
      ]),
    );
  });

  it("first load: a snapshot requested after the cache was written still wins", async () => {
    await ingest(at("ev-gone", "Deleted on the server"));
    await ingest(at("ev-old", "Stale"));
    await removeCalendarEventFromCache(username, "ev-back");
    const requestedAt = await requestSnapshot();

    await writeCalendarBootstrapToCache(
      username,
      snapshot([at("ev-old", "Fresh"), at("ev-back", "Created again")]),
      { window: liveWindow, requestedAt },
    );

    expect([...(await events())].sort()).toEqual([
      ["ev-back", "Created again"],
      ["ev-old", "Fresh"],
    ]);
  });

  it("window load: an event of the window does not replace a newer row", async () => {
    const requestedAt = await requestSnapshot();
    await ingest(at("ev-old", "Renamed meanwhile"));

    const stored = await upsertSnapshotCalendarEventInCache(
      username,
      at("ev-old", "Old"),
      requestedAt,
    );

    expect(stored).toBe(false);
    expect((await events()).get("ev-old")).toBe("Renamed meanwhile");
  });

  it("window load: an event removed after the window was requested stays gone", async () => {
    const requestedAt = await requestSnapshot();
    await removeCalendarEventFromCache(username, "ev-old");

    await upsertSnapshotCalendarEventInCache(username, at("ev-old", "Old"), requestedAt);

    expect((await events()).has("ev-old")).toBe(false);
  });

  it("window load: stores a new event and replaces an older row", async () => {
    const requestedAt = await requestSnapshot();

    await upsertSnapshotCalendarEventInCache(username, at("ev-old", "Fresh"), requestedAt);
    await upsertSnapshotCalendarEventInCache(username, at("ev-new", "New"), requestedAt);

    expect([...(await events())].sort()).toEqual([
      ["ev-new", "New"],
      ["ev-old", "Fresh"],
    ]);
  });

  it("forgets a removal after ten minutes, at the next snapshot write", async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const removals = () => db.meta.where("key").startsWith("calendars:removed-event:").keys();
    await removeCalendarEventFromCache(username, "ev-old");
    await db.meta.put({
      key: "calendars:removed-event:ev-long-ago",
      value: String(Date.now() - 11 * 60_000),
    });

    await writeCalendarBootstrapToCache(username, snapshot([]), { window: liveWindow });

    const left = await removals();
    expect(left).toContain("calendars:removed-event:ev-old");
    expect(left).not.toContain("calendars:removed-event:ev-long-ago");
  });

  it("period load: keeps an event stored after the period was requested", async () => {
    const requestedAt = await requestSnapshot();
    await ingest(at("ev-new", "Arrived meanwhile"));

    await mergeCalendarRangeIntoCache(username, week, [at("ev-old", "Old")], { requestedAt });

    expect((await events()).get("ev-new")).toBe("Arrived meanwhile");
  });

  it("period load: keeps a change stored after the period was requested", async () => {
    const requestedAt = await requestSnapshot();
    await ingest(at("ev-old", "Renamed meanwhile"));

    await mergeCalendarRangeIntoCache(username, week, [at("ev-old", "Old")], { requestedAt });

    expect((await events()).get("ev-old")).toBe("Renamed meanwhile");
  });

  it("period load: does not bring back an event removed after the period was requested", async () => {
    const requestedAt = await requestSnapshot();
    await removeCalendarEventFromCache(username, "ev-old");

    await mergeCalendarRangeIntoCache(username, week, [at("ev-old", "Old")], { requestedAt });

    expect((await events()).has("ev-old")).toBe(false);
  });

  it("period load: a period requested after the cache was written still wins", async () => {
    await ingest(at("ev-gone", "Deleted on the server"));
    const requestedAt = await requestSnapshot();

    await mergeCalendarRangeIntoCache(username, week, [at("ev-old", "Fresh")], { requestedAt });

    expect([...(await events())]).toEqual([["ev-old", "Fresh"]]);
  });
});
