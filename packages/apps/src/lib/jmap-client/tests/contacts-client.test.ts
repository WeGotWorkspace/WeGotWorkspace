import { describe, expect, it } from "vitest";
import { JmapContactsClient } from "../contacts/JmapContactsClient.js";
import { CONTACTS_CAPABILITY, CORE_CAPABILITY, type JmapInvocation } from "../core/types.js";
import { JmapClient } from "../core/JmapClient.js";

const ACCOUNT = "bob";
const SESSION_URL = "https://mock.example/jmap/session";
const API_URL = "https://mock.example/jmap/api";

function sessionJson() {
  return {
    capabilities: {
      [CORE_CAPABILITY]: {},
      [CONTACTS_CAPABILITY]: {},
    },
    accounts: {
      [ACCOUNT]: {
        name: ACCOUNT,
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [CONTACTS_CAPABILITY]: {} },
      },
    },
    primaryAccounts: { [CONTACTS_CAPABILITY]: ACCOUNT },
    username: ACCOUNT,
    apiUrl: API_URL,
    downloadUrl: `${API_URL}/download/{accountId}/{blobId}/{name}?type={type}`,
    uploadUrl: `${API_URL}/upload/{accountId}`,
    eventSourceUrl: `${API_URL}/eventsource`,
    state: "s1",
  };
}

function methodResponse(name: string, args: Record<string, unknown>, id: string): JmapInvocation {
  return [name, args, id];
}

async function makeClient(handler: (calls: JmapInvocation[]) => JmapInvocation[]) {
  const recorded: JmapInvocation[][] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    if (input === SESSION_URL) {
      return new Response(JSON.stringify(sessionJson()), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as {
      using: string[];
      methodCalls: JmapInvocation[];
    };
    recorded.push(body.methodCalls);
    expect(body.using).toEqual([CORE_CAPABILITY, CONTACTS_CAPABILITY]);
    return new Response(
      JSON.stringify({ methodResponses: handler(body.methodCalls), sessionState: "s1" }),
      { status: 200 },
    );
  };
  const client = new JmapClient({ sessionUrl: SESSION_URL, fetch: fetchImpl });
  await client.connect();
  return { client, contacts: new JmapContactsClient(client), recorded };
}

describe("JmapContactsClient contract batches", () => {
  it("initial sync is AddressBook/get + ContactCard/get with ids null", async () => {
    const { contacts, recorded } = await makeClient((calls) =>
      calls.map(([name, , id]) =>
        methodResponse(name, { accountId: ACCOUNT, state: "0:", list: [], notFound: [] }, id),
      ),
    );

    await contacts.getAddressBooksAndCards(ACCOUNT);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.map(([name]) => name)).toEqual(["AddressBook/get", "ContactCard/get"]);
    expect(recorded[0]?.[0]?.[1]).toEqual({ accountId: ACCOUNT, ids: null });
    expect(recorded[0]?.[1]?.[1]).toEqual({ accountId: ACCOUNT, ids: null });
  });

  it("query+get uses the #ids ResultReference", async () => {
    const { contacts, recorded } = await makeClient((calls) => {
      const queryId = calls[0]?.[2] ?? "c1";
      return [
        methodResponse("ContactCard/query", { accountId: ACCOUNT, ids: ["card-1"] }, queryId),
        methodResponse(
          "ContactCard/get",
          { accountId: ACCOUNT, state: "1:", list: [{ id: "card-1" }], notFound: [] },
          calls[1]?.[2] ?? "c2",
        ),
      ];
    });

    const got = await contacts.getContactCardsByQuery(ACCOUNT);
    expect(got.list[0]?.id).toBe("card-1");
    expect(recorded[0]?.[0]).toEqual([
      "ContactCard/query",
      { accountId: ACCOUNT },
      expect.any(String),
    ]);
    expect(recorded[0]?.[1]?.[1]).toEqual({
      accountId: ACCOUNT,
      "#ids": {
        resultOf: recorded[0]?.[0]?.[2],
        name: "ContactCard/query",
        path: "/ids",
      },
    });
  });

  it("per-book list only sends the inAddressBook filter", async () => {
    const { contacts, recorded } = await makeClient((calls) => [
      methodResponse("ContactCard/query", { accountId: ACCOUNT, ids: [] }, calls[0]?.[2] ?? "c1"),
      methodResponse(
        "ContactCard/get",
        { accountId: ACCOUNT, state: "1:", list: [], notFound: [] },
        calls[1]?.[2] ?? "c2",
      ),
    ]);

    await contacts.getContactCardsByQuery(ACCOUNT, { inAddressBook: "default" });
    expect(recorded[0]?.[0]?.[1]).toEqual({
      accountId: ACCOUNT,
      filter: { inAddressBook: "default" },
    });
  });

  it("set/changes use ContactCard methods without extra filters", async () => {
    const { contacts, recorded } = await makeClient((calls) => {
      const [name, , id] = calls[0] ?? ["", {}, "c0"];
      if (name === "ContactCard/set") {
        return [
          methodResponse(
            name,
            {
              accountId: ACCOUNT,
              created: { k0: { id: "card-1" } },
              updated: {},
              destroyed: [],
              newState: "1:",
            },
            id,
          ),
        ];
      }
      return [
        methodResponse(
          name,
          { accountId: ACCOUNT, created: ["card-1"], updated: [], destroyed: [], newState: "1:" },
          id,
        ),
      ];
    });

    await contacts.setContactCards({
      accountId: ACCOUNT,
      create: { k0: { name: { full: "Jane" } } },
    });
    await contacts.contactCardChanges(ACCOUNT, "0:");
    await contacts.setContactCards({
      accountId: ACCOUNT,
      update: { "card-1": { name: { full: "Renamed" } } },
    });
    await contacts.setContactCards({ accountId: ACCOUNT, destroy: ["card-1"] });

    const names = recorded.map((batch) => batch[0]?.[0]);
    expect(names).toEqual([
      "ContactCard/set",
      "ContactCard/changes",
      "ContactCard/set",
      "ContactCard/set",
    ]);
    expect(recorded[1]?.[0]?.[1]).toEqual({ accountId: ACCOUNT, sinceState: "0:" });
    expect(recorded[3]?.[0]?.[1]).toEqual({ accountId: ACCOUNT, destroy: ["card-1"] });
  });
});
