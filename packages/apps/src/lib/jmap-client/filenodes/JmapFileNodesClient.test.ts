import { describe, expect, it } from "vitest";
import { JmapClient } from "../core/JmapClient.js";
import {
  CALENDARS_CAPABILITY,
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  type JmapInvocation,
  type JmapRequest,
  type JmapSession,
} from "../core/types.js";
import { FILENODE_USING, JmapFileNodesClient } from "./JmapFileNodesClient.js";

const SESSION_URL = "/jmap/session";
const API_URL = "/jmap";
const ACCOUNT_ID = "bob";

type RecordedCall = { using: string[]; methodCalls: JmapInvocation[] };

function session(): JmapSession {
  return {
    capabilities: {
      [CORE_CAPABILITY]: { maxSizeUpload: 25_000_000 },
      [CALENDARS_CAPABILITY]: {},
      [FILENODE_CAPABILITY]: {},
    },
    accounts: {
      [ACCOUNT_ID]: {
        name: ACCOUNT_ID,
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [FILENODE_CAPABILITY]: {} },
      },
    },
    primaryAccounts: {
      [CALENDARS_CAPABILITY]: ACCOUNT_ID,
      [FILENODE_CAPABILITY]: ACCOUNT_ID,
    },
    username: ACCOUNT_ID,
    apiUrl: API_URL,
    downloadUrl: "/jmap/download/{accountId}/{blobId}/{name}?type={type}",
    uploadUrl: "/jmap/upload/{accountId}",
    eventSourceUrl: "/jmap/eventsource",
    state: "1",
  };
}

function makeClient(handler: (body: JmapRequest) => unknown): {
  client: JmapClient;
  recorded: RecordedCall[];
} {
  const recorded: RecordedCall[] = [];
  const client = new JmapClient({
    sessionUrl: SESSION_URL,
    fetch: async (input, init) => {
      if (input === SESSION_URL) {
        return new Response(JSON.stringify(session()), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as JmapRequest;
      recorded.push({ using: body.using, methodCalls: body.methodCalls });
      return new Response(JSON.stringify(handler(body)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { client, recorded };
}

describe("JmapFileNodesClient", () => {
  it("emits the contract-test query+get ResultReference batch", async () => {
    const { client, recorded } = makeClient((body) => ({
      methodResponses: body.methodCalls.map(([name, , id]) => {
        if (name === "FileNode/query") {
          return [name, { accountId: ACCOUNT_ID, ids: ["fn-1"], queryState: "1" }, id];
        }
        return [
          name,
          {
            accountId: ACCOUNT_ID,
            state: "1",
            list: [{ id: "fn-1", name: "readme.md" }],
            notFound: [],
          },
          id,
        ];
      }),
      sessionState: "1",
    }));
    await client.connect();
    const fileNodes = new JmapFileNodesClient(client);

    const got = await fileNodes.queryAndGetFileNodes(ACCOUNT_ID, { parentId: "fn-docs" });

    expect(got.list[0]?.name).toBe("readme.md");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.using).toEqual(FILENODE_USING);
    const [queryCall, getCall] = recorded[0]!.methodCalls;
    expect(queryCall?.[0]).toBe("FileNode/query");
    expect(queryCall?.[1]).toEqual({ accountId: ACCOUNT_ID, filter: { parentId: "fn-docs" } });
    expect(getCall?.[0]).toBe("FileNode/get");
    expect(getCall?.[1]).toEqual({
      accountId: ACCOUNT_ID,
      "#ids": { resultOf: queryCall?.[2], name: "FileNode/query", path: "/ids" },
    });
  });

  it("uses FileNode/set create then destroy with filenode using", async () => {
    const { client, recorded } = makeClient((body) => {
      const [name, args, id] = body.methodCalls[0]!;
      if (name === "FileNode/set" && args.create) {
        return {
          methodResponses: [
            [
              name,
              {
                accountId: ACCOUNT_ID,
                newState: "2",
                created: {
                  d0: { id: "fn-dir", name: "Docs", parentId: "fn-home", nodeType: "directory" },
                },
              },
              id,
            ],
          ],
          sessionState: "1",
        };
      }
      return {
        methodResponses: [
          [name, { accountId: ACCOUNT_ID, newState: "3", destroyed: ["fn-1"] }, id],
        ],
        sessionState: "1",
      };
    });
    await client.connect();
    const fileNodes = new JmapFileNodesClient(client);

    await fileNodes.setFileNodes({
      accountId: ACCOUNT_ID,
      create: { d0: { parentId: "fn-home", name: "Docs" } },
    });
    await fileNodes.setFileNodes({ accountId: ACCOUNT_ID, destroy: ["fn-1"] });

    expect(recorded.map((row) => row.using)).toEqual([FILENODE_USING, FILENODE_USING]);
    expect(recorded[0]?.methodCalls[0]?.[1]).toMatchObject({
      create: { d0: { parentId: "fn-home", name: "Docs" } },
    });
    expect(recorded[1]?.methodCalls[0]?.[1]).toMatchObject({ destroy: ["fn-1"] });
  });
});
