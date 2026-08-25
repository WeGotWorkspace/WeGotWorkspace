import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { CALENDARS_DOMAIN } from "@/lib/offline/calendars/calendars-schema";
import {
  enqueueOutboxMutation,
  listOutboxMutations,
  readCalendarBootstrapFromCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";

const username = "bob";

function wireEvent(id: string, title: string): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: `urn:uuid:${id}`,
    calendarIds: { default: true },
    title,
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
    calendars: [{ id: "default", name: "Personal", color: "#6366f1", isDefault: true }],
    events: [wireEvent("ev-1", "Standup")],
  },
} satisfies CalendarAppBootstrap;

const {
  createCalendarEventLive,
  patchCalendarEventLive,
  patchCalendarLive,
  fetchCalendarLiveBootstrap,
  importEventsLive,
} = vi.hoisted(() => ({
  createCalendarEventLive: vi.fn(),
  patchCalendarEventLive: vi.fn(),
  patchCalendarLive: vi.fn(),
  fetchCalendarLiveBootstrap: vi.fn(),
  importEventsLive: vi.fn(),
  searchCalendarSharePrincipalsLive: vi.fn(),
}));

vi.mock("@/lib/api/wgw/calendar", () => ({
  createCalendarEventLive,
  patchCalendarEventLive,
  deleteCalendarEventLive: vi.fn(),
  createCalendarLive: vi.fn(),
  patchCalendarLive,
  deleteCalendarLive: vi.fn(),
  fetchCalendarLiveBootstrap,
  importEventsLive,
  searchCalendarSharePrincipalsLive: vi.fn(),
}));

vi.mock("@/lib/api/wgw/calendar-ics-webcal", () => ({
  createCalendarSubscriptionLive: vi.fn(),
  deleteCalendarSubscriptionLive: vi.fn(),
  getCalendarFeedLive: vi.fn(),
  getCalendarSubscriptionLive: vi.fn(),
  listCalendarSubscriptionsLive: vi.fn(async () => []),
  publishCalendarFeedLive: vi.fn(),
  refreshStaleCalendarSubscriptionsLive: vi.fn(async () => false),
  unpublishCalendarFeedLive: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      return error.message.toLowerCase().includes("network");
    }
    return false;
  }),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  createHybridCalendarOperations,
  fetchCalendarHybridBootstrap,
  getCalendarsSyncRunner,
} from "@/lib/offline/calendars-hybrid-operations";

async function enqueuePendingCreate(): Promise<void> {
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: CALENDARS_DOMAIN,
    op: "create",
    payload: JSON.stringify({
      creationId: "local-1",
      tempEventId: "local-1",
      draft: {
        calendarId: "default",
        title: "Created",
        start: "2033-01-11T09:00:00",
        duration: "PT1H",
      },
    }),
  });
}

describe("flushCalendarsOutboxAndReport", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await writeCalendarBootstrapToCache(username, bootstrap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips flush while offline and leaves outbox rows pending", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    createCalendarEventLive.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueuePendingCreate();

    await getCalendarsSyncRunner(username).flush();

    expect(createCalendarEventLive).not.toHaveBeenCalled();
    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.op).toBe("create");
    expect(rows[0]?.lastError).toBeUndefined();
    expect(rows[0]?.retries).toBe(0);
  });

  it("queues calendar collection CRUD while offline and keeps groups available", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await writeCalendarBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        groups: [{ slug: "engineering", displayName: "Engineering" }],
      },
    });

    const operations = createHybridCalendarOperations(username);
    const created = await operations.createCalendar!({
      name: "Team",
      color: "#22c55e",
      groupSlug: "engineering",
    });
    expect(created.groupSlug).toBe("engineering");
    expect(created.scope).toBe("group");

    const renamed = await operations.patchCalendar!(created.id, { name: "Engineering" });
    expect(renamed.name).toBe("Engineering");

    await operations.deleteCalendar!(created.id);

    const rows = await listOutboxMutations(username);
    expect(rows.map((row) => row.op)).toEqual([
      "calendarCreate",
      "calendarUpdate",
      "calendarDelete",
    ]);
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.groups).toEqual([{ slug: "engineering", displayName: "Engineering" }]);
    expect(cached?.data.calendars.some((calendar) => calendar.id === created.id)).toBe(false);
  });

  it("reuses the engine temp id for offline create then patch", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridCalendarOperations(username);
    const created = await operations.createEvent({
      id: "local-engine-1",
      calendarId: "default",
      title: "Created",
      start: "2033-01-11T09:00:00",
      duration: "PT1H",
    });
    expect(created.id).toBe("local-engine-1");

    const patched = await operations.patchEvent("local-engine-1", {
      start: "2033-01-11T10:00:00",
    });
    expect(patched.start).toBe("2033-01-11T10:00:00");

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "local-engine-1")?.start).toBe(
      "2033-01-11T10:00:00",
    );
    const rows = await listOutboxMutations(username);
    expect(rows.map((row) => row.op)).toEqual(["create", "update"]);
    expect(JSON.parse(rows[1]?.payload ?? "{}").eventId).toBe("local-engine-1");
  });

  it("writes a duration patch into the Dexie cache while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridCalendarOperations(username);
    const patched = await operations.patchEvent("ev-1", { duration: "PT2H" });
    expect(patched.duration).toBe("PT2H");

    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.find((event) => event.id === "ev-1")?.duration).toBe("PT2H");
  });

  it("keeps the local update after reconnect when live bootstrap is still stale", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridCalendarOperations(username);
    await operations.patchEvent("ev-1", { title: "Offline edit" });

    vi.mocked(readBrowserOnline).mockReturnValue(true);
    fetchCalendarLiveBootstrap.mockResolvedValue(bootstrap);
    patchCalendarEventLive.mockResolvedValue(wireEvent("ev-1", "Offline edit"));

    const next = await fetchCalendarHybridBootstrap();

    expect(patchCalendarEventLive).toHaveBeenCalledWith("ev-1", { title: "Offline edit" });
    expect(next.data.events.find((event) => event.id === "ev-1")?.title).toBe("Offline edit");
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });

  it("persists shareWith on cached calendars and refuses offline share grants", async () => {
    const shareWith = {
      alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
    };
    patchCalendarLive.mockResolvedValue({
      id: "default",
      name: "Personal",
      color: "#6366f1",
      isDefault: true,
      mayWrite: true,
      mayShare: true,
      shareWith,
    });

    const operations = createHybridCalendarOperations(username);
    const updated = await operations.patchCalendar!("default", { shareWith });
    expect(updated.shareWith).toEqual(shareWith);
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.calendars.find((calendar) => calendar.id === "default")?.shareWith).toEqual(
      shareWith,
    );

    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await expect(
      operations.patchCalendar!("default", {
        shareWith: { bob: { mayWrite: true } },
      }),
    ).rejects.toThrow("Sharing changes require a connection.");
    await expect(listOutboxMutations(username)).resolves.toEqual([]);
  });

  it("refuses offline owner transfers", async () => {
    const operations = createHybridCalendarOperations(username);
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await expect(operations.patchCalendar!("work", { groupSlug: "editorial" })).rejects.toThrow(
      "Owner changes require a connection.",
    );
    await expect(listOutboxMutations(username)).resolves.toEqual([]);
  });

  it("flushes pending outbox rows when online", async () => {
    createCalendarEventLive.mockResolvedValue(wireEvent("ev-2", "Created"));
    await enqueuePendingCreate();

    await getCalendarsSyncRunner(username).flush();

    expect(createCalendarEventLive).toHaveBeenCalledTimes(1);
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });

  it("does not queue subscribe or publish while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridCalendarOperations(username);
    await expect(
      operations.subscribeCalendar!({ url: "https://feeds.example.test/holidays.ics" }),
    ).rejects.toThrow(/requires a connection/);
    await expect(operations.publishCalendarFeed!("default")).rejects.toThrow(
      /requires a connection/,
    );
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });
});

describe("hybrid importEvents", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await writeCalendarBootstrapToCache(username, bootstrap);
  });

  it("upserts imported events into Dexie when online", async () => {
    importEventsLive.mockResolvedValue({
      list: [wireEvent("imported-1", "Imported")],
      errors: [],
    });
    const operations = createHybridCalendarOperations(username);
    const result = await operations.importEvents!("BEGIN:VCALENDAR", { calendarId: "default" });

    expect(importEventsLive).toHaveBeenCalledWith("BEGIN:VCALENDAR", { calendarId: "default" });
    expect(result.list[0]?.id).toBe("imported-1");
    const cached = await readCalendarBootstrapFromCache(username);
    expect(cached?.data.events.some((event) => event.id === "imported-1")).toBe(true);
  });

  it("throws when offline and does not queue", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridCalendarOperations(username);
    await expect(
      operations.importEvents!("BEGIN:VCALENDAR", { calendarId: "default" }),
    ).rejects.toThrow(/internet connection/);
    expect(importEventsLive).not.toHaveBeenCalled();
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });
});
