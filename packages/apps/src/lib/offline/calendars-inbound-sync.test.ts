import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapClient } from "@/lib/jmap-client";
import {
  personalCalendar,
  recurringEvent,
  timedEvent,
  workCalendar,
} from "@/lib/jmap-client/mock/fixtures";
import { MockJmapServer } from "@/lib/jmap-client/mock/MockJmapServer";
import { syncCalendarEventChanges } from "@/lib/offline/calendars-inbound-sync";

const pending = new Set<string>();
const cache = new Map<string, string | undefined>();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/calendars-offline-store", () => ({
  listPendingCalendarEventIds: async () => [...pending],
  upsertCalendarEventInCache: async (_user: string, event: { id: string; title?: string }) => {
    cache.set(event.id, event.title);
  },
  removeCalendarEventFromCache: async (_user: string, id: string) => {
    cache.delete(id);
  },
  upsertCalendarInCache: vi.fn(),
  removeCalendarFromCache: vi.fn(),
  listCachedEventsForCalendar: async () => [],
}));

vi.mock("@/lib/offline/calendars-sync-conflicts", () => ({
  reportCalendarsSyncConflicts: (...args: unknown[]) => reportConflicts(...args),
}));

const MARCH = {
  utcStart: new Date("2026-03-01T00:00:00Z"),
  utcEnd: new Date("2026-04-01T00:00:00Z"),
};

async function setup() {
  const server = new MockJmapServer();
  server.seedCalendar(workCalendar);
  server.seedCalendar(personalCalendar);
  server.seedEvent(timedEvent);
  server.seedEvent(recurringEvent);
  const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  await client.connect();
  const accountId = client.primaryAccountId();
  const source = { client, accountId, range: MARCH as typeof MARCH | undefined };
  return { server, client, accountId, source };
}

function calls(server: MockJmapServer, method: string) {
  return server.methodCalls.filter(([name]) => name === method).map(([, args]) => args);
}

beforeEach(() => {
  pending.clear();
  cache.clear();
  reportConflicts.mockReset();
});

describe("syncCalendarEventChanges", () => {
  it("pulls changes since the client's state, fetches them in one get and applies them", async () => {
    const { server, client, accountId, source } = await setup();
    client.setState(accountId, "CalendarEvent", server.state);
    const since = server.state;
    server.remoteUpdateEvent("ev-timed", { title: "Renamed remotely" });
    const created = server.remoteCreateEvent({
      "@type": "Event",
      uid: "uid-remote-1",
      calendarIds: { "cal-work": true },
      title: "Remote event",
      start: "2026-03-25T09:00:00",
      duration: "PT30M",
    });
    cache.set("ev-recurring", "Weekly");
    server.remoteDestroyEvent("ev-recurring");

    const result = await syncCalendarEventChanges("owner", source);

    expect(result).toEqual({ changed: true, usedFullResync: false });
    expect(calls(server, "CalendarEvent/changes").map((args) => args.sinceState)).toEqual([since]);
    expect(calls(server, "CalendarEvent/get")).toHaveLength(1);
    expect(cache.get("ev-timed")).toBe("Renamed remotely");
    expect(cache.get(created)).toBe("Remote event");
    expect(cache.has("ev-recurring")).toBe(false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("skips an event with a pending write and reports it as a conflict", async () => {
    const { server, client, accountId, source } = await setup();
    client.setState(accountId, "CalendarEvent", server.state);
    cache.set("ev-timed", "Mine");
    pending.add("ev-timed");
    server.remoteUpdateEvent("ev-timed", { title: "Theirs" });
    server.remoteUpdateEvent("ev-recurring", { title: "Other" });

    await syncCalendarEventChanges("owner", source);

    expect(cache.get("ev-timed")).toBe("Mine");
    expect(cache.get("ev-recurring")).toBe("Other");
    expect(reportConflicts).toHaveBeenCalledWith(["ev-timed"]);
    expect(reportConflicts).toHaveBeenCalledTimes(1);
  });

  it("leaves out a changed id the get no longer returns", async () => {
    const { server, client, accountId, source } = await setup();
    client.setState(accountId, "CalendarEvent", server.state);
    server.remoteUpdateEvent("ev-timed", { title: "Renamed" });
    server.beforeRequest = (methodCalls) => {
      if (methodCalls.some(([name]) => name === "CalendarEvent/get")) {
        server.beforeRequest = null;
        server.remoteDestroyEvent("ev-timed");
      }
    };

    await expect(syncCalendarEventChanges("owner", source)).resolves.toEqual({
      changed: false,
      usedFullResync: false,
    });
    expect(cache.has("ev-timed")).toBe(false);
  });

  it("runs nothing before the window has loaded a state", async () => {
    const { server, source } = await setup();

    await expect(syncCalendarEventChanges("owner", source)).resolves.toEqual({
      changed: false,
      usedFullResync: false,
    });
    expect(calls(server, "CalendarEvent/changes")).toHaveLength(0);
  });

  it("re-lists the loaded window when the state expired, and removes nothing", async () => {
    const { server, client, accountId, source } = await setup();
    client.setState(accountId, "CalendarEvent", "stale");
    cache.set("ev-gone-elsewhere", "Gone");
    server.remoteUpdateEvent("ev-timed", { title: "Renamed" });

    const result = await syncCalendarEventChanges("owner", source);

    expect(result.usedFullResync).toBe(true);
    expect(calls(server, "CalendarEvent/query")).toHaveLength(1);
    expect(cache.get("ev-timed")).toBe("Renamed");
    expect(cache.has("ev-recurring")).toBe(true);
    expect(cache.get("ev-gone-elsewhere"), "kept, as the adapter's re-list did").toBe("Gone");
    expect(client.getState(accountId, "CalendarEvent")).toBe(server.state);
  });

  it("lists nothing on an expired state when no window was loaded", async () => {
    const { server, client, accountId, source } = await setup();
    client.setState(accountId, "CalendarEvent", "stale");

    const result = await syncCalendarEventChanges("owner", { ...source, range: undefined });

    expect(result).toEqual({ changed: false, usedFullResync: true });
    expect(calls(server, "CalendarEvent/query")).toHaveLength(0);
    expect(cache.size).toBe(0);
  });
});
