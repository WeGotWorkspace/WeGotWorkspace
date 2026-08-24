import { describe, expect, it } from "vitest";
import { JmapEventsAdapter } from "../adapter/JmapEventsAdapter.js";
import type { JmapCalendarEvent } from "../calendars/types.js";
import { JmapClient } from "../core/JmapClient.js";
import { personalCalendar, recurringEvent, timedEvent, workCalendar } from "../mock/fixtures.js";
import { MockJmapServer } from "../mock/MockJmapServer.js";

const MARCH: { utcStart: Date; utcEnd: Date } = {
  utcStart: new Date("2026-03-01T00:00:00Z"),
  utcEnd: new Date("2026-04-01T00:00:00Z"),
};

async function makeAdapter(
  server: MockJmapServer,
  hooks: {
    onRemoteEvent?: (event: JmapCalendarEvent) => void;
    onRemoteEventDestroyed?: (eventId: string) => void;
  } = {},
) {
  const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  const adapter = new JmapEventsAdapter({
    client,
    onRemoteEvent: hooks.onRemoteEvent,
    onRemoteEventDestroyed: hooks.onRemoteEventDestroyed,
  });
  await adapter.initialize(MARCH);
  return adapter;
}

function seedServer(server: MockJmapServer): void {
  server.seedCalendar(workCalendar);
  server.seedCalendar(personalCalendar);
  server.seedEvent(timedEvent);
  server.seedEvent(recurringEvent);
}

describe("JmapEventsAdapter initialization", () => {
  it("loads calendars (with rights/visibility) and forwards the window inbound", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const remoteEvents: string[] = [];
    const adapter = await makeAdapter(server, {
      onRemoteEvent: (event) => {
        if (event.id) remoteEvents.push(event.id);
      },
    });

    const calendars = adapter.getCalendars();
    expect(calendars.size).toBe(2);
    expect(calendars.get("cal-work")).toMatchObject({
      displayName: "Work",
      color: "#3366cc",
      isDefault: true,
      myRights: { mayWriteAll: true },
    });
    // cal-personal has isVisible: false, so visibility narrows to cal-work:
    expect(adapter.getVisibleCalendarIds()).toEqual(["cal-work"]);
    expect(adapter.getSelectedCalendarId()).toBe("cal-work");
    expect(adapter.getCalendarAccounts()).toEqual(new Set([server.accountId]));

    expect(remoteEvents).toEqual(expect.arrayContaining(["ev-timed", "ev-recurring"]));
    expect(adapter).not.toHaveProperty("getEvents");
    expect(adapter).not.toHaveProperty("apply");
  });
});

describe("JmapEventsAdapter sync", () => {
  it("forwards remote creates, updates and destroys via /changes", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const titlesById = new Map<string, string | undefined>();
    const destroyed: string[] = [];
    const adapter = await makeAdapter(server, {
      onRemoteEvent: (event) => {
        if (event.id) titlesById.set(event.id, event.title);
      },
      onRemoteEventDestroyed: (eventId) => {
        destroyed.push(eventId);
        titlesById.delete(eventId);
      },
    });

    server.remoteUpdateEvent("ev-timed", { title: "Renamed remotely" });
    const remoteId = server.remoteCreateEvent({
      "@type": "Event",
      uid: "uid-remote-1",
      calendarIds: { "cal-work": true },
      title: "Remote event",
      start: "2026-03-25T09:00:00",
      duration: "PT30M",
    });
    server.remoteDestroyEvent("ev-recurring");

    await adapter.sync();

    expect(titlesById.get("ev-timed")).toBe("Renamed remotely");
    expect(titlesById.get(remoteId)).toBe("Remote event");
    expect(destroyed).toContain("ev-recurring");
    expect(titlesById.has("ev-recurring")).toBe(false);
  });
});
