import { describe, expect, it } from "vitest";
import { JmapCalendarsClient } from "../calendars/JmapCalendarsClient.js";
import { JmapMethodError, JmapRequestError } from "../core/errors.js";
import { JmapClient } from "../core/JmapClient.js";
import { recurringEvent, timedEvent, workCalendar } from "../mock/fixtures.js";
import { MockJmapServer } from "../mock/MockJmapServer.js";

function makeClient(server: MockJmapServer): JmapClient {
  return new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
}

describe("JmapClient", () => {
  it("fetches the session and exposes the primary calendars account", async () => {
    const server = new MockJmapServer();
    const client = makeClient(server);
    const session = await client.connect();
    expect(session.apiUrl).toBe(server.apiUrl);
    expect(client.primaryAccountId()).toBe(server.accountId);
  });

  it("rejects servers without the calendars capability", async () => {
    const server = new MockJmapServer();
    const brokenFetch: typeof server.fetch = async (input, init) => {
      if (input === server.sessionUrl) {
        const session = server.session();
        delete (session.capabilities as Record<string, unknown>)["urn:ietf:params:jmap:calendars"];
        return new Response(JSON.stringify(session), { status: 200 });
      }
      return server.fetch(input, init);
    };
    const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: brokenFetch });
    await expect(client.connect()).rejects.toThrow(JmapRequestError);
  });

  it("throws typed method errors from error invocations", async () => {
    const server = new MockJmapServer();
    const client = makeClient(server);
    await client.connect();
    await expect(client.call("Bogus/method", { accountId: server.accountId })).rejects.toThrow(
      JmapMethodError,
    );
  });

  it("tracks per-type state from typed method responses", async () => {
    const server = new MockJmapServer();
    server.seedCalendar(workCalendar);
    const client = makeClient(server);
    await client.connect();
    const calendars = new JmapCalendarsClient(client);
    expect(client.getState(server.accountId, "Calendar")).toBeUndefined();
    await calendars.getCalendars(server.accountId);
    expect(client.getState(server.accountId, "Calendar")).toBe(server.state);
  });
});

describe("JmapCalendarsClient windowed queries", () => {
  it("fetches events in a range with one batched query+get round trip", async () => {
    const server = new MockJmapServer();
    server.seedEvent(timedEvent);
    server.seedEvent(recurringEvent);
    server.seedEvent({
      ...timedEvent,
      id: "ev-outside",
      uid: "uid-outside",
      start: "2027-01-01T10:00:00",
    });
    const client = makeClient(server);
    await client.connect();
    const calendars = new JmapCalendarsClient(client);

    server.requestCount = 0;
    const response = await calendars.getCalendarEventsInRange(server.accountId, {
      utcStart: new Date("2026-03-01T00:00:00Z"),
      utcEnd: new Date("2026-04-01T00:00:00Z"),
    });

    expect(server.requestCount).toBe(1);
    const ids = response.list.map((event) => event.id).sort();
    expect(ids).toEqual(["ev-recurring", "ev-timed"]);
    expect(client.getState(server.accountId, "CalendarEvent")).toBe(server.state);
  });

  it("reports rejected set records as typed errors", async () => {
    const server = new MockJmapServer();
    server.seedEvent(timedEvent);
    const client = makeClient(server);
    await client.connect();
    const calendars = new JmapCalendarsClient(client);

    server.failNextSetWith = { type: "forbidden" };
    await expect(
      calendars.setCalendarEvents({
        accountId: server.accountId,
        update: { [timedEvent.id]: { title: "Nope" } },
      }),
    ).rejects.toMatchObject({ name: "JmapSetItemError", setError: { type: "forbidden" } });
  });
});
