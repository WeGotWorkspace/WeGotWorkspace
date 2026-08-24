import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";
import {
  readCalendarBootstrapFromCache,
  upsertCalendarEventInCache,
  writeCalendarBootstrapToCache,
} from "@/lib/offline/calendars-offline-store";

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
    calendars: [{ id: "default", name: "Personal", color: "#6366f1", isDefault: true }],
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
