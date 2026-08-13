// Live e2e: the UNMODIFIED @lit-calendar/jmap-client against the WeGotWorkspace
// JMAP envelope (docs/calendars/jmap-envelope.md). Canonical copy lives in the
// backend repo at tools/jmap-client-e2e/; tools/test-jmap-client-e2e.sh copies
// it into the client's src/tests/ for the run and removes it afterwards.
//
// Skips unless JMAP_E2E_URL + JMAP_E2E_TOKEN are set, so it never runs in the
// client repo's normal offline suite.
import { describe, expect, it } from "vitest";
import { JmapCalendarsClient } from "../calendars/JmapCalendarsClient.js";
import { JmapClient } from "../core/JmapClient.js";

const base = process.env.JMAP_E2E_URL;
const token = process.env.JMAP_E2E_TOKEN;
const CALENDARS_URN = "urn:ietf:params:jmap:calendars";

describe.skipIf(!base || !token)("wgw backend e2e (real client, live API)", () => {
  it("runs the full adapter lifecycle incrementally", async () => {
    const client = new JmapClient({
      sessionUrl: `${base}/api/v1/jmap/session`,
      headers: { Authorization: `Bearer ${token}` },
    });

    // connect(): key-checks both URNs, accountId from primaryAccounts.
    const session = await client.connect();
    expect(session.capabilities).toHaveProperty(CALENDARS_URN);
    const accountId = session.primaryAccounts[CALENDARS_URN];

    const calendars = new JmapCalendarsClient(client);

    // refreshCalendars() + loadRange() equivalents.
    const calendarGet = await calendars.getCalendars(accountId);
    expect(calendarGet.list.length).toBeGreaterThan(0);
    const calendarState = calendarGet.state;

    const range = {
      utcStart: new Date("2033-01-01T00:00:00Z"),
      utcEnd: new Date("2033-02-01T00:00:00Z"),
    };
    const initial = await calendars.getCalendarEventsInRange(accountId, range);
    const eventState = initial.state;

    // create → flush().
    const set = await calendars.setCalendarEvents({
      accountId,
      create: {
        "e2e-1": {
          "@type": "Event",
          calendarIds: { [calendarGet.list[0].id]: true },
          title: "wgw e2e lifecycle",
          start: "2033-01-10T10:00:00",
          duration: "PT1H",
          timeZone: "Etc/UTC",
        },
      },
    });
    const createdId = set.created?.["e2e-1"]?.id as string;
    expect(createdId).toBeTruthy();

    // The created event is visible through the query+get "#ids" batch.
    const ranged = await calendars.getCalendarEventsInRange(accountId, range);
    expect(ranged.list.map((event) => event.id)).toContain(createdId);

    // Post-flush sync() MUST take the incremental path — a
    // cannotCalculateChanges error here is the mismatch-13 regression
    // (the adapter would fall back to the expensive #refetchAll()).
    const calDelta = await calendars.calendarChanges(accountId, calendarState);
    expect(typeof calDelta.newState).toBe("string");
    const delta = await calendars.calendarEventChanges(accountId, eventState);
    expect(delta.created).toContain(createdId);

    // Self-clean: destroy, then the next delta reports it.
    await calendars.setCalendarEvents({ accountId, destroy: [createdId] });
    const after = await calendars.calendarEventChanges(accountId, delta.newState);
    expect(after.destroyed).toContain(createdId);
  });
});
