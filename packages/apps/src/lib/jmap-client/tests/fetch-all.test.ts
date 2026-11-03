import { describe, expect, it } from "vitest";
import { JmapMethodError, JmapRequestError } from "../core/errors.js";
import { fetchAllByQuery } from "../core/fetch-all.js";
import { JmapClient } from "../core/JmapClient.js";
import { CORE_CAPABILITY, NOTES_CAPABILITY } from "../core/types.js";
import { MockJmapServer } from "../mock/MockJmapServer.js";

const USING = [CORE_CAPABILITY, NOTES_CAPABILITY];

async function setup(count: number) {
  const server = new MockJmapServer();
  for (let index = 0; index < count; index++) {
    server.seedRecord("Note", { id: `n-${index}`, notebookId: index % 2 ? "odd" : "even" });
  }
  const client = new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  await client.connect();
  return { server, client };
}

function queryPositions(server: MockJmapServer): number[] {
  return server.methodCalls
    .filter(([name]) => name === "Note/query")
    .map(([, args]) => args.position as number);
}

describe("fetchAllByQuery", () => {
  it("pages the query and passes the filter", async () => {
    const { server, client } = await setup(250);

    const result = await fetchAllByQuery<{ id: string }>(client, {
      accountId: server.accountId,
      type: "Note",
      using: USING,
      filter: { inNotebook: "odd" },
      queryPageSize: 50,
    });

    expect(result.list).toHaveLength(125);
    expect(result.list.every(({ id }) => Number(id.slice(2)) % 2 === 1)).toBe(true);
    expect(queryPositions(server)).toEqual([0, 50, 100]);
    expect(client.getState(server.accountId, "Note")).toBe(result.state);
  });

  it("starts the listing again when the result set changes between pages", async () => {
    const { server, client } = await setup(120);
    server.beforeRequest = (calls) => {
      if (!calls.some(([name, args]) => name === "Note/query" && args.position === 50)) return;
      server.beforeRequest = null;
      server.remoteUpsertRecord("Note", { id: "n-new", notebookId: "even" });
    };

    const result = await fetchAllByQuery<{ id: string }>(client, {
      accountId: server.accountId,
      type: "Note",
      using: USING,
      queryPageSize: 50,
    });

    expect(result.list).toHaveLength(121);
    expect(queryPositions(server)).toEqual([0, 50, 0, 50, 100]);
  });

  it("gives up when the result set keeps changing", async () => {
    const { server, client } = await setup(120);
    let counter = 0;
    server.beforeRequest = (calls) => {
      if (calls.some(([name, args]) => name === "Note/query" && args.position === 50)) {
        server.remoteUpsertRecord("Note", { id: `n-churn-${counter++}`, notebookId: "even" });
      }
    };

    await expect(
      fetchAllByQuery(client, {
        accountId: server.accountId,
        type: "Note",
        using: USING,
        queryPageSize: 50,
      }),
    ).rejects.toThrow(JmapRequestError);
  });

  it("throws the query's method error", async () => {
    const { server, client } = await setup(3);

    await expect(
      fetchAllByQuery(client, {
        accountId: server.accountId,
        type: "Note",
        using: USING,
        filter: { text: "x" },
      }),
    ).rejects.toThrow(JmapMethodError);
  });

  it("skips the body request when there is nothing to fetch", async () => {
    const { server, client } = await setup(0);

    const result = await fetchAllByQuery(client, {
      accountId: server.accountId,
      type: "Note",
      using: USING,
    });

    expect(result.list).toEqual([]);
    expect(server.requestCount).toBe(1);
  });
});
