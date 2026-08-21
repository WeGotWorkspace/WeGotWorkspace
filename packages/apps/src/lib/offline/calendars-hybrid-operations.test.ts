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

const { createCalendarEventLive } = vi.hoisted(() => ({
  createCalendarEventLive: vi.fn(),
}));

vi.mock("@/lib/api/wgw/calendar", () => ({
  createCalendarEventLive,
  patchCalendarEventLive: vi.fn(),
  deleteCalendarEventLive: vi.fn(),
  createCalendarLive: vi.fn(),
  patchCalendarLive: vi.fn(),
  deleteCalendarLive: vi.fn(),
  fetchCalendarLiveBootstrap: vi.fn(),
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

  it("flushes pending outbox rows when online", async () => {
    createCalendarEventLive.mockResolvedValue(wireEvent("ev-2", "Created"));
    await enqueuePendingCreate();

    await getCalendarsSyncRunner(username).flush();

    expect(createCalendarEventLive).toHaveBeenCalledTimes(1);
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });
});
