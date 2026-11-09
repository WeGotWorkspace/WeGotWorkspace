import type {
  CalendarAvailabilityGetResponse,
  CalendarAvailabilityTeamMemberGetResponse,
} from "@wgw/openapi-types/calendars-types";
import { describe, expect, it } from "vitest";
import { JmapMethodError } from "../core/errors.js";
import { JmapClient } from "../core/JmapClient.js";
import { AVAILABILITY_CAPABILITY, CORE_CAPABILITY } from "../core/types.js";
import { timedEvent } from "../mock/fixtures.js";
import { MockJmapServer } from "../mock/MockJmapServer.js";

const using = { using: [CORE_CAPABILITY, AVAILABILITY_CAPABILITY] };

async function connected(): Promise<{ server: MockJmapServer; client: JmapClient }> {
  const server = new MockJmapServer();
  server.availability.seedTeamMember({ id: "ann", name: "Ann", isSelf: false, version: "v1" });
  server.availability.seedTeamMember({ id: "me", name: "Me", isSelf: true, version: "v1" });
  server.availability.seedBusyPeriods("ann", [
    { start: "2030-01-07T10:00:00Z", timeZone: null, duration: "PT1H", showWithoutTime: false },
    {
      start: "2030-01-08T09:00:00",
      timeZone: "Europe/Amsterdam",
      duration: "PT30M",
      showWithoutTime: false,
      title: "Review",
      eventId: timedEvent.id,
    },
    { start: "2030-01-20", timeZone: null, duration: "P1D", showWithoutTime: true },
  ]);
  server.seedEvent(timedEvent);
  const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  await client.connect();
  return { server, client };
}

describe("MockJmapServer urn:wgw:jmap:availability", () => {
  it("advertises the capability and its limits", async () => {
    const { client } = await connected();
    expect(client.session.capabilities[AVAILABILITY_CAPABILITY]).toEqual({});
  });

  it("TeamMember/get lists people, reports unknown ids and changes state", async () => {
    const { server, client } = await connected();
    const all = await client.call<CalendarAvailabilityTeamMemberGetResponse>(
      "TeamMember/get",
      { accountId: server.accountId, ids: null },
      using,
    );
    expect(all.list.map((member) => member.id)).toEqual(["ann", "me"]);

    const some = await client.call<CalendarAvailabilityTeamMemberGetResponse>(
      "TeamMember/get",
      { accountId: server.accountId, ids: ["ann", "zed"] },
      using,
    );
    expect(some.notFound).toEqual(["zed"]);

    server.availability.seedTeamMember({ id: "ann", name: "Ann", isSelf: false, version: "v2" });
    const after = await client.call<CalendarAvailabilityTeamMemberGetResponse>(
      "TeamMember/get",
      { accountId: server.accountId, ids: null },
      using,
    );
    expect(after.state).not.toBe(all.state);
  });

  it("TeamMember/getAvailability returns the week's periods without mock-only fields", async () => {
    const { server, client } = await connected();
    const week = await client.call<CalendarAvailabilityGetResponse>(
      "TeamMember/getAvailability",
      {
        accountId: server.accountId,
        ids: ["ann", "zed"],
        utcStart: "2030-01-07T00:00:00Z",
        utcEnd: "2030-01-14T00:00:00Z",
      },
      using,
    );
    expect(week.notFound).toEqual(["zed"]);
    expect(week.list).toEqual([
      {
        id: "ann",
        complete: true,
        periods: [
          {
            start: "2030-01-07T10:00:00Z",
            timeZone: null,
            duration: "PT1H",
            showWithoutTime: false,
          },
          {
            start: "2030-01-08T09:00:00",
            timeZone: "Europe/Amsterdam",
            duration: "PT30M",
            showWithoutTime: false,
            title: "Review",
          },
        ],
      },
    ]);

    const excluded = await client.call<CalendarAvailabilityGetResponse>(
      "TeamMember/getAvailability",
      {
        accountId: server.accountId,
        ids: ["ann"],
        utcStart: "2030-01-07T00:00:00Z",
        utcEnd: "2030-01-21T00:00:00Z",
        excludeEventId: timedEvent.id,
      },
      using,
    );
    expect(excluded.list[0]?.periods.map((period) => period.start)).toEqual([
      "2030-01-07T10:00:00Z",
      "2030-01-20",
    ]);
  });

  it("reports an incomplete person", async () => {
    const { server, client } = await connected();
    server.availability.seedBusyPeriods("ann", [], false);
    const result = await client.call<CalendarAvailabilityGetResponse>(
      "TeamMember/getAvailability",
      {
        accountId: server.accountId,
        ids: ["ann"],
        utcStart: "2030-01-07T00:00:00Z",
        utcEnd: "2030-01-14T00:00:00Z",
      },
      using,
    );
    expect(result.list[0]?.complete).toBe(false);
  });

  it.each([
    [
      "a range that does not start on Monday 00:00Z",
      { utcStart: "2030-01-08T00:00:00Z", utcEnd: "2030-01-15T00:00:00Z" },
    ],
    [
      "a range that is not whole weeks",
      { utcStart: "2030-01-07T00:00:00Z", utcEnd: "2030-01-10T00:00:00Z" },
    ],
    ["more than 54 weeks", { utcStart: "2030-01-07T00:00:00Z", utcEnd: "2031-01-27T00:00:00Z" }],
    [
      "more than 540 person-weeks",
      { ids: Array.from({ length: 11 }, (_, i) => `p${i}`), utcEnd: "2030-12-30T00:00:00Z" },
    ],
    ["more than 50 ids", { ids: Array.from({ length: 51 }, (_, i) => `p${i}`) }],
    ["an unknown excludeEventId", { excludeEventId: "ev-nope" }],
  ])("rejects %s with invalidArguments", async (_label, overrides) => {
    const { server, client } = await connected();
    const call = client.call(
      "TeamMember/getAvailability",
      {
        accountId: server.accountId,
        ids: ["ann"],
        utcStart: "2030-01-07T00:00:00Z",
        utcEnd: "2030-01-14T00:00:00Z",
        ...overrides,
      },
      using,
    );
    await expect(call).rejects.toBeInstanceOf(JmapMethodError);
    await expect(call).rejects.toMatchObject({ errorType: "invalidArguments" });
  });
});
