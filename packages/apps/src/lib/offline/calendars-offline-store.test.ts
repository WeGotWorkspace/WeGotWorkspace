import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import {
  mergeCalendarRangeIntoCache,
  readCalendarBootstrapFromCache,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";
import { calendarsEventsTable } from "@/lib/offline/calendars/calendars-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";

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
