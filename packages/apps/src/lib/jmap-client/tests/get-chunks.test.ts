import { describe, expect, it } from "vitest";
import { JmapCalendarsClient } from "../calendars/JmapCalendarsClient.js";
import { JmapChatClient } from "../chat/JmapChatClient.js";
import { JmapClient } from "../core/JmapClient.js";
import { DEFAULT_MAX_OBJECTS_IN_GET, getInChunks, maxObjectsInGet } from "../core/get-chunks.js";
import {
  CALENDARS_CAPABILITY,
  CHAT_CAPABILITY,
  CORE_CAPABILITY,
  NOTES_CAPABILITY,
  type GetResponse,
  type JmapInvocation,
} from "../core/types.js";
import { JmapNotesClient } from "../notes/JmapNotesClient.js";

const ACCOUNT = "bob";
const SESSION_URL = "https://mock.example/jmap/session";
const API_URL = "https://mock.example/jmap/api";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `id-${index}`);
}

/** A server that answers each `Foo/get` with the asked ids and fails over `limit`. */
async function makeServer(limit: number) {
  const getCalls: { name: string; ids: string[] | null }[] = [];
  let pageCount = 0;
  const fetchImpl = async (input: string, init?: RequestInit) => {
    if (input === SESSION_URL) {
      return new Response(
        JSON.stringify({
          capabilities: {
            [CORE_CAPABILITY]: { maxObjectsInGet: limit, maxCallsInRequest: 16 },
            [NOTES_CAPABILITY]: {},
            [CALENDARS_CAPABILITY]: {},
            [CHAT_CAPABILITY]: {},
          },
          accounts: {
            [ACCOUNT]: {
              name: ACCOUNT,
              isPersonal: true,
              isReadOnly: false,
              accountCapabilities: {},
            },
          },
          primaryAccounts: {
            [NOTES_CAPABILITY]: ACCOUNT,
            [CALENDARS_CAPABILITY]: ACCOUNT,
            [CHAT_CAPABILITY]: ACCOUNT,
          },
          username: ACCOUNT,
          apiUrl: API_URL,
          downloadUrl: `${API_URL}/download/{accountId}/{blobId}/{name}?type={type}`,
          uploadUrl: `${API_URL}/upload/{accountId}`,
          eventSourceUrl: `${API_URL}/eventsource`,
          state: "s1",
        }),
        { status: 200 },
      );
    }
    const body = JSON.parse(String(init?.body)) as { methodCalls: JmapInvocation[] };
    const methodResponses = body.methodCalls.map(([name, args, callId]): JmapInvocation => {
      const asked = (args as { ids: string[] | null }).ids;
      getCalls.push({ name, ids: asked });
      if (asked && asked.length > limit) {
        return ["error", { type: "requestTooLarge" }, callId];
      }
      pageCount += 1;
      const found = (asked ?? []).filter((id) => id !== "id-missing");
      return [
        name,
        {
          accountId: ACCOUNT,
          state: `state-${pageCount}`,
          list: found.map((id) => ({ id })),
          notFound: (asked ?? []).filter((id) => id === "id-missing"),
        },
        callId,
      ];
    });
    return new Response(JSON.stringify({ methodResponses, sessionState: "s1" }), { status: 200 });
  };
  const client = new JmapClient({ sessionUrl: SESSION_URL, fetch: fetchImpl });
  await client.connect();
  return { client, getCalls };
}

describe("getInChunks", () => {
  const page = (pageIds: string[], state: string): GetResponse<{ id: string }> => ({
    accountId: ACCOUNT,
    state,
    list: pageIds.map((id) => ({ id })),
    notFound: [],
  });

  it("sends one request when the ids fit", async () => {
    const asked: string[][] = [];
    const result = await getInChunks(ids(3), 3, async (pageIds) => {
      asked.push(pageIds);
      return page(pageIds, "only");
    });
    expect(asked).toEqual([ids(3)]);
    expect(result.list).toHaveLength(3);
    expect(result.state).toBe("only");
  });

  it("splits ids over the limit, keeps order and returns the first page's state", async () => {
    const asked: string[][] = [];
    let call = 0;
    const result = await getInChunks(ids(5), 2, async (pageIds) => {
      asked.push(pageIds);
      call += 1;
      return page(pageIds, `s${call}`);
    });
    expect(asked).toEqual([["id-0", "id-1"], ["id-2", "id-3"], ["id-4"]]);
    expect(result.list.map((item) => item.id)).toEqual(ids(5));
    expect(result.state).toBe("s1");
  });

  it("stops at the first failing page", async () => {
    let call = 0;
    await expect(
      getInChunks(ids(5), 2, async (pageIds) => {
        call += 1;
        if (call === 2) throw new Error("boom");
        return page(pageIds, "s");
      }),
    ).rejects.toThrow("boom");
    expect(call).toBe(2);
  });

  it("reads maxObjectsInGet from the session, with a default", () => {
    expect(maxObjectsInGet({ capabilities: { [CORE_CAPABILITY]: { maxObjectsInGet: 7 } } })).toBe(
      7,
    );
    expect(maxObjectsInGet({ capabilities: { [CORE_CAPABILITY]: {} } })).toBe(
      DEFAULT_MAX_OBJECTS_IN_GET,
    );
    expect(maxObjectsInGet({ capabilities: {} })).toBe(DEFAULT_MAX_OBJECTS_IN_GET);
  });
});

describe("clients chunk a get over maxObjectsInGet", () => {
  const cases = [
    {
      method: "Note/get",
      run: (client: JmapClient, asked: string[]) =>
        new JmapNotesClient(client).getNotes(ACCOUNT, asked),
    },
    {
      method: "CalendarEvent/get",
      run: (client: JmapClient, asked: string[]) =>
        new JmapCalendarsClient(client).getCalendarEvents(ACCOUNT, asked),
    },
    {
      method: "ChatMessage/get",
      run: (client: JmapClient, asked: string[]) =>
        new JmapChatClient(client).getMessages(ACCOUNT, asked),
    },
  ];

  for (const { method, run } of cases) {
    it(`${method}: 5 ids with a limit of 2 go in 3 requests and all come back`, async () => {
      const { client, getCalls } = await makeServer(2);
      const asked = [...ids(4), "id-missing"];
      const result = await run(client, asked);
      expect(getCalls.map((call) => call.ids?.length)).toEqual([2, 2, 1]);
      expect(getCalls.every((call) => call.name === method)).toBe(true);
      expect(result.list.map((item) => item.id)).toEqual(ids(4));
      expect(result.notFound).toEqual(["id-missing"]);
      expect(result.state).toBe("state-1");
    });

    it(`${method}: ids: null stays one request`, async () => {
      const { client, getCalls } = await makeServer(2);
      const runNull = run as unknown as (client: JmapClient, asked: null) => Promise<unknown>;
      await runNull(client, null);
      expect(getCalls).toEqual([{ name: method, ids: null }]);
    });
  }
});
