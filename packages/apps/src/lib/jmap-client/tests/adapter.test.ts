import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { JmapEventsAdapter } from "../adapter/JmapEventsAdapter.js";
import { JmapClient } from "../core/JmapClient.js";
import { personalCalendar, recurringEvent, timedEvent, workCalendar } from "../mock/fixtures.js";
import { MockJmapServer } from "../mock/MockJmapServer.js";

const MARCH: { utcStart: Date; utcEnd: Date } = {
  utcStart: new Date("2026-03-01T00:00:00Z"),
  utcEnd: new Date("2026-04-01T00:00:00Z"),
};

async function makeAdapter(server: MockJmapServer, onSyncError?: (error: unknown) => void) {
  const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  const adapter = new JmapEventsAdapter({ client, timezone: "Europe/Amsterdam", onSyncError });
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
  it("loads calendars (with rights/visibility) and windowed events", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

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

    const events = adapter.getEvents();
    expect(events.get("ev-timed")?.data.summary).toBe("Design review");
    expect(events.get("ev-recurring")?.isRecurring).toBe(true);
    expect(events.get("ev-recurring::20260311T090000")?.isException).toBe(true);
  });
});

describe("JmapEventsAdapter optimistic mutations", () => {
  it("creates optimistically, pushes, and confirms with the server id mapping", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

    const start = Temporal.PlainDateTime.from("2026-03-20T14:00:00");
    const result = adapter.create({
      event: {
        calendarId: "cal-work",
        data: { start, end: start.add({ hours: 1 }), summary: "New meeting" },
      },
    });
    const [change] = result.changes;
    if (change.type !== "created") throw new Error("expected created change");
    const localKey = change.key;

    // Optimistic: visible immediately, marked pending.
    expect(adapter.getEvents().get(localKey)?.pendingOp).toBe("created");

    await adapter.flush();

    // Confirmed: same local key, pending cleared, present on the server.
    const confirmed = adapter.getEvents().get(localKey);
    expect(confirmed?.pendingOp).toBeUndefined();
    expect(confirmed?.data.summary).toBe("New meeting");
    const serverCopy = [...server.events.values()].find((ev) => ev.title === "New meeting");
    expect(serverCopy).toBeDefined();
    expect(serverCopy?.calendarIds).toEqual({ "cal-work": true });
    expect(serverCopy?.duration).toBe("PT1H");
  });

  it("updates optimistically and preserves opaque server properties on push", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

    adapter.update({
      target: { key: "ev-timed" },
      scope: "single",
      patch: { summary: "Design review (v2)" },
    });
    expect(adapter.getEvents().get("ev-timed")?.pendingOp).toBe("updated");

    await adapter.flush();

    expect(adapter.getEvents().get("ev-timed")?.pendingOp).toBeUndefined();
    const serverCopy = server.events.get("ev-timed");
    expect(serverCopy?.title).toBe("Design review (v2)");
    // Participants/alerts the internal model does not render survived the update:
    expect(serverCopy?.participants).toEqual(timedEvent.participants);
    expect(serverCopy?.alerts).toEqual(timedEvent.alerts);
  });

  it("pushes moves as start changes", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

    adapter.move({
      target: { key: "ev-timed" },
      scope: "single",
      delta: Temporal.Duration.from({ days: 1 }),
    });
    await adapter.flush();

    expect(server.events.get("ev-timed")?.start).toBe("2026-03-11T10:00:00");
  });

  it("destroys removed events on the server", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

    adapter.remove({ target: { key: "ev-timed" }, scope: "series" });
    // Optimistic: row still present but marked deleted (hidden from expansion).
    expect(adapter.getEvents().get("ev-timed")?.pendingOp).toBe("deleted");

    await adapter.flush();

    expect(adapter.getEvents().has("ev-timed")).toBe(false);
    expect(server.events.has("ev-timed")).toBe(false);
  });

  it("recovers from a rejected push by restoring server truth", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const errors: unknown[] = [];
    const adapter = await makeAdapter(server, (error) => errors.push(error));

    server.failNextSetWith = { type: "forbidden" };
    adapter.update({
      target: { key: "ev-timed" },
      scope: "single",
      patch: { summary: "Not allowed" },
    });
    await adapter.flush();

    expect(errors).toHaveLength(1);
    // Local state rolled back to the server copy:
    expect(adapter.getEvents().get("ev-timed")?.data.summary).toBe("Design review");
    expect(adapter.getEvents().get("ev-timed")?.pendingOp).toBeUndefined();
    expect(server.events.get("ev-timed")?.title).toBe("Design review");
  });
});

describe("JmapEventsAdapter sync", () => {
  it("applies remote creates, updates and destroys via /changes", async () => {
    const server = new MockJmapServer();
    seedServer(server);
    const adapter = await makeAdapter(server);

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

    const events = adapter.getEvents();
    expect(events.get("ev-timed")?.data.summary).toBe("Renamed remotely");
    expect(events.get(remoteId)?.data.summary).toBe("Remote event");
    expect(events.has("ev-recurring")).toBe(false);
    expect(events.has("ev-recurring::20260311T090000")).toBe(false);
  });

  it("does not clobber local pending edits with remote data", async () => {
    const server = new MockJmapServer();
    seedServer(server);

    // Block pushes so the local edit stays pending during sync.
    let releasePush: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    const gatedFetch: typeof server.fetch = async (input, init) => {
      if (init?.method === "POST" && String(init.body).includes('"CalendarEvent/set"')) {
        await gate;
      }
      return server.fetch(input, init);
    };
    const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: gatedFetch });
    const adapter = new JmapEventsAdapter({ client, timezone: "Europe/Amsterdam" });
    await adapter.initialize(MARCH);

    adapter.update({
      target: { key: "ev-timed" },
      scope: "single",
      patch: { summary: "Local edit" },
    });
    server.remoteUpdateEvent("ev-timed", { title: "Remote edit" });
    await adapter.sync();

    // Local pending edit wins until the push completes.
    expect(adapter.getEvents().get("ev-timed")?.data.summary).toBe("Local edit");

    releasePush?.();
    await adapter.flush();
    expect(server.events.get("ev-timed")?.title).toBe("Local edit");
  });
});
