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

function session(core: Record<string, unknown> = {}): JmapSession {
  return {
    capabilities: {
      [CORE_CAPABILITY]: { maxSizeUpload: 25_000_000, ...core },
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

function makeClient(
  handler: (body: JmapRequest) => unknown,
  core: Record<string, unknown> = {},
): {
  client: JmapClient;
  recorded: RecordedCall[];
} {
  const recorded: RecordedCall[] = [];
  const client = new JmapClient({
    sessionUrl: SESSION_URL,
    fetch: async (input, init) => {
      if (input === SESSION_URL) {
        return new Response(JSON.stringify(session(core)), { status: 200 });
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

  describe("queryAndGetFileNodes past maxObjectsInGet", () => {
    /**
     * Server stand-in: answers the query with `ids`, rejects a get of more
     * than `max` ids with `requestTooLarge` (as `HandlesGetArguments` does),
     * and echoes each id back as a node with a per-request state.
     */
    function largeFolderServer(ids: string[], max: number) {
      let getRequests = 0;
      return (body: JmapRequest) => {
        const queryIds = new Map<string, string[]>();
        return {
          methodResponses: body.methodCalls.map(([name, args, id]) => {
            if (name === "FileNode/query") {
              queryIds.set(id, ids);
              return [name, { accountId: ACCOUNT_ID, ids, queryState: "1", position: 0 }, id];
            }
            const ref = args["#ids"] as { resultOf: string } | undefined;
            const requested = ref ? (queryIds.get(ref.resultOf) ?? []) : (args.ids as string[]);
            if (requested.length > max) {
              return [
                "error",
                { type: "requestTooLarge", description: "ids exceeds maxObjectsInGet." },
                id,
              ];
            }
            getRequests += 1;
            return [
              name,
              {
                accountId: ACCOUNT_ID,
                state: `s${getRequests}`,
                list: requested.map((nodeId) => ({ id: nodeId, name: `${nodeId}.txt` })),
                notFound: [],
              },
              id,
            ];
          }),
          sessionState: "1",
        };
      };
    }

    it("fetches the query ids in chunks of the session's maxObjectsInGet", async () => {
      const ids = ["fn-1", "fn-2", "fn-3", "fn-4", "fn-5"];
      const { client, recorded } = makeClient(largeFolderServer(ids, 2), { maxObjectsInGet: 2 });
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      const got = await fileNodes.queryAndGetFileNodes(ACCOUNT_ID, { parentId: "fn-big" });

      expect(got.list.map((node) => node.id)).toEqual(ids);
      expect(got.notFound).toEqual([]);
      expect(got.state).toBe("s3");
      expect(client.getState(ACCOUNT_ID, "FileNode")).toBe("s3");
      const chunkGets = recorded.slice(1).map((row) => row.methodCalls);
      expect(chunkGets.map((calls) => calls.map(([name, args]) => [name, args.ids]))).toEqual([
        [["FileNode/get", ["fn-1", "fn-2"]]],
        [["FileNode/get", ["fn-3", "fn-4"]]],
        [["FileNode/get", ["fn-5"]]],
      ]);
      for (const row of recorded) expect(row.using).toEqual(FILENODE_USING);
    });

    it("falls back to 500-id chunks when the session does not state maxObjectsInGet", async () => {
      const ids = Array.from({ length: 1012 }, (_, index) => `fn-${index}`);
      const { client, recorded } = makeClient(largeFolderServer(ids, 500));
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      const got = await fileNodes.queryAndGetFileNodes(ACCOUNT_ID, { parentId: "fn-big" });

      expect(got.list).toHaveLength(1012);
      expect(got.list.map((node) => node.id)).toEqual(ids);
      expect(
        recorded.slice(1).map((row) => (row.methodCalls[0]?.[1].ids as string[]).length),
      ).toEqual([500, 500, 12]);
    });

    it("keeps a folder at the limit to the single query+get round trip", async () => {
      const ids = ["fn-1", "fn-2"];
      const { client, recorded } = makeClient(largeFolderServer(ids, 2), { maxObjectsInGet: 2 });
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      const got = await fileNodes.queryAndGetFileNodes(ACCOUNT_ID, { parentId: "fn-small" });

      expect(got.list.map((node) => node.id)).toEqual(ids);
      expect(recorded).toHaveLength(1);
    });

    it("still throws when the get fails for another reason", async () => {
      const { client, recorded } = makeClient((body) => ({
        methodResponses: body.methodCalls.map(([name, , id]) =>
          name === "FileNode/query"
            ? [name, { accountId: ACCOUNT_ID, ids: ["fn-1"], queryState: "1" }, id]
            : ["error", { type: "forbidden" }, id],
        ),
        sessionState: "1",
      }));
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      await expect(
        fileNodes.queryAndGetFileNodes(ACCOUNT_ID, { parentId: "fn-docs" }),
      ).rejects.toThrow(/FileNode query\+get failed: .*forbidden/);
      expect(recorded).toHaveLength(1);
    });
  });

  describe("getFileNodes past maxObjectsInGet", () => {
    /** Rejects a get of more than `max` ids with `requestTooLarge`; echoes the rest. */
    function getServer(max: number) {
      let getRequests = 0;
      return (body: JmapRequest) => ({
        methodResponses: body.methodCalls.map(([name, args, id]) => {
          const requested = (args.ids as string[] | null) ?? [];
          if (requested.length > max) {
            return [
              "error",
              { type: "requestTooLarge", description: "ids exceeds maxObjectsInGet." },
              id,
            ];
          }
          getRequests += 1;
          return [
            name,
            {
              accountId: ACCOUNT_ID,
              state: `s${getRequests}`,
              list: requested
                .filter((nodeId) => nodeId !== "fn-missing")
                .map((nodeId) => ({ id: nodeId, name: `${nodeId}.txt` })),
              notFound: requested.filter((nodeId) => nodeId === "fn-missing"),
            },
            id,
          ];
        }),
        sessionState: "1",
      });
    }

    it("fetches more than 500 ids in 500-id chunks when the session does not state the limit", async () => {
      const ids = Array.from({ length: 1012 }, (_, index) => `fn-${index}`);
      const { client, recorded } = makeClient(getServer(500));
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      const got = await fileNodes.getFileNodes(ACCOUNT_ID, ids);

      expect(got.list.map((node) => node.id)).toEqual(ids);
      expect(got.state).toBe("s3");
      expect(client.getState(ACCOUNT_ID, "FileNode")).toBe("s3");
      expect(recorded.map((row) => (row.methodCalls[0]?.[1].ids as string[]).length)).toEqual([
        500, 500, 12,
      ]);
      for (const row of recorded) expect(row.using).toEqual(FILENODE_USING);
    });

    it("uses the session's maxObjectsInGet and merges notFound across chunks", async () => {
      const ids = ["fn-1", "fn-missing", "fn-3"];
      const { client, recorded } = makeClient(getServer(2), { maxObjectsInGet: 2 });
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      const got = await fileNodes.getFileNodes(ACCOUNT_ID, ids);

      expect(got.list.map((node) => node.id)).toEqual(["fn-1", "fn-3"]);
      expect(got.notFound).toEqual(["fn-missing"]);
      expect(recorded.map((row) => row.methodCalls[0]?.[1].ids)).toEqual([
        ["fn-1", "fn-missing"],
        ["fn-3"],
      ]);
    });

    it("keeps a list at the limit, an empty list, and null to one request", async () => {
      const { client, recorded } = makeClient(getServer(2), { maxObjectsInGet: 2 });
      await client.connect();
      const fileNodes = new JmapFileNodesClient(client);

      await fileNodes.getFileNodes(ACCOUNT_ID, ["fn-1", "fn-2"]);
      const empty = await fileNodes.getFileNodes(ACCOUNT_ID, []);
      await fileNodes.getFileNodes(ACCOUNT_ID, null);

      expect(empty.state).toBe("s2");
      expect(recorded.map((row) => row.methodCalls[0]?.[1].ids)).toEqual([
        ["fn-1", "fn-2"],
        [],
        null,
      ]);
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
