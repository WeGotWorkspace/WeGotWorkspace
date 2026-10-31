import { describe, expect, it } from "vitest";
import {
  listRemovedIds,
  readPendingWrites,
  runScopedInbound,
  serverMovedSince,
  type ScopeChanges,
  type ScopedInboundBinding,
} from "./inbound-sync";
import type { OfflineOutboxRow } from "./types";

type Row = { id: string; scope: string; version: string };
type Cached = { id: string; scope: string | undefined; createPending: boolean };

function outboxRow(
  id: string,
  op: string,
  itemId: string | null,
  extra: Partial<OfflineOutboxRow> = {},
): OfflineOutboxRow {
  return {
    id,
    domain: "fake",
    op,
    payload: JSON.stringify({ itemId, fields: op === "update" ? ["title"] : [] }),
    createdAt: 0,
    retries: 0,
    ...extra,
  };
}

const view = (row: OfflineOutboxRow) => {
  const payload = JSON.parse(row.payload) as { itemId: string | null; fields: string[] };
  return { id: payload.itemId, fields: payload.fields, deleting: row.op === "delete" };
};

describe("readPendingWrites", () => {
  it("collects bases in order, fields, deletes and the token hold per item", () => {
    const writes = readPendingWrites(
      [
        outboxRow("r1", "update", "a", { ifInState: "v1" }),
        outboxRow("r2", "update", "a", { ifInState: "v2" }),
        outboxRow("r3", "delete", "b", { lastError: "stateMismatch", retries: 1 }),
        outboxRow("r4", "update", null),
      ],
      view,
      ["a", "c"],
    );
    expect([...writes.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(writes.get("a")).toEqual({
      bases: ["v1", "v2"],
      fields: new Set(["title"]),
      deleting: false,
      blocksToken: true,
      queued: true,
    });
    expect(writes.get("b")).toMatchObject({ deleting: true, blocksToken: false, queued: true });
    // Only a pendingSync cache row: protected, but nothing queued to send.
    expect(writes.get("c")).toMatchObject({ bases: [], queued: false, blocksToken: false });
  });

  it("keeps a token hold when one of several rows is still retryable", () => {
    const writes = readPendingWrites(
      [
        outboxRow("r1", "update", "a", { lastError: "stateMismatch", retries: 1 }),
        outboxRow("r2", "update", "a"),
      ],
      view,
    );
    expect(writes.get("a")?.blocksToken).toBe(true);
  });
});

describe("serverMovedSince", () => {
  it("is not a conflict while the server still has the queued write's base", () => {
    expect(serverMovedSince(["v1"], "v1", "moved")).toBe(false);
    expect(serverMovedSince(["v1"], "v1", "not-moved")).toBe(false);
  });

  it("is a conflict once the server moved past any queued base", () => {
    expect(serverMovedSince(["v1"], "v2", "not-moved")).toBe(true);
    expect(serverMovedSince(["v1", "v2"], "v2", "moved")).toBe(true);
  });

  it("follows the domain's policy when a base or the server version is unknown", () => {
    expect(serverMovedSince([], "v1", "moved")).toBe(true);
    expect(serverMovedSince(["v1"], undefined, "moved")).toBe(true);
    expect(serverMovedSince([], "v1", "not-moved")).toBe(false);
    expect(serverMovedSince(["v1"], null, "not-moved")).toBe(false);
  });
});

describe("listRemovedIds", () => {
  it("removes cached items the full list lacks, except the ones the domain keeps", () => {
    const cached = [
      { id: "listed", keep: false },
      { id: "gone", keep: false },
      { id: "queued", keep: true },
    ];
    expect(listRemovedIds(cached, new Set(["listed"]), (item) => item.keep)).toEqual(["gone"]);
  });
});

/** An in-memory server and cache with two scopes. */
function fakeDomain(options: {
  tokens?: Record<string, string>;
  server?: Row[];
  cache?: Cached[];
  changes?: Record<string, ScopeChanges | Error>;
  queued?: string[];
  blocking?: string[];
  pending?: string[];
}) {
  const tokens = new Map(Object.entries(options.tokens ?? {}));
  const server = new Map((options.server ?? []).map((row) => [row.id, row]));
  const cache = new Map((options.cache ?? []).map((item) => [item.id, item]));
  const pending = new Set(options.pending ?? []);
  const ingested: string[] = [];
  const destroyedCalls: string[] = [];
  const fetched: string[] = [];
  const goneScopes: string[] = [];
  const binding: ScopedInboundBinding<Row, Cached> = {
    readToken: async (scope) => tokens.get(scope) ?? null,
    writeToken: async (scope, token) => {
      tokens.set(scope, token);
    },
    changes: async (scope) => {
      const answer = options.changes?.[scope];
      if (!answer) throw new Error(`no changes for ${scope}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    isCannotCalculateChanges: (error) => (error as Error).message === "cannotCalculateChanges",
    list: async (scope) => [...server.values()].filter((row) => row.scope === scope),
    currentState: async (scope) => `${scope}-now`,
    rowId: (row) => row.id,
    fetch: async (id) => {
      fetched.push(id);
      const row = server.get(id);
      if (!row) throw new Error(`fetch ${id} failed`);
      return row;
    },
    readCached: async () => {
      const queued = new Set(options.queued ?? []);
      return {
        items: [...cache.values()],
        keep: (item) => item.createPending || queued.has(item.id),
      };
    },
    scopeGone: {
      matches: (error) => (error as Error).message === "notFound",
      apply: async (scope) => {
        goneScopes.push(scope);
      },
    },
    createApplier: async () => ({
      ingest: async (row) => {
        ingested.push(row.id);
        if (pending.has(row.id)) return "skipped-pending";
        cache.set(row.id, { id: row.id, scope: row.scope, createPending: false });
        return "upserted";
      },
      ingestDestroyed: async (id) => {
        destroyedCalls.push(id);
        if (pending.has(id)) return "skipped-pending";
        cache.delete(id);
        return "removed";
      },
      blocksToken: new Set(options.blocking ?? []),
    }),
  };
  return { binding, tokens, cache, ingested, destroyedCalls, fetched, goneScopes };
}

const noChanges = (newState: string): ScopeChanges => ({
  created: [],
  updated: [],
  destroyed: [],
  newState,
});

describe("runScopedInbound", () => {
  it("fetches only changed ids and advances each scope's token", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1", b: "b1" },
      server: [{ id: "n1", scope: "a", version: "1" }],
      changes: { a: { ...noChanges("a2"), created: ["n1"] }, b: noChanges("b2") },
    });
    const result = await runScopedInbound(["a", "b"], domain.binding);
    expect(result).toEqual({ changed: true, usedFullResync: false });
    expect(domain.fetched).toEqual(["n1"]);
    expect(Object.fromEntries(domain.tokens)).toEqual({ a: "a2", b: "b2" });
  });

  it("lists a scope with no token once, removes what it lacks and keeps queued items", async () => {
    const domain = fakeDomain({
      server: [{ id: "kept", scope: "a", version: "1" }],
      cache: [
        { id: "kept", scope: "a", createPending: false },
        { id: "gone", scope: "a", createPending: false },
        { id: "unsent", scope: "a", createPending: true },
        { id: "queued", scope: "a", createPending: false },
        { id: "other-scope", scope: "b", createPending: false },
      ],
      queued: ["queued"],
      tokens: { b: "b1" },
      changes: { b: noChanges("b1") },
    });
    const result = await runScopedInbound(["a", "b"], domain.binding);
    expect(result.usedFullResync).toBe(true);
    // The listed row is ingested as it is, without a fetch.
    expect(domain.fetched).toEqual([]);
    expect(domain.ingested).toEqual(["kept"]);
    expect(domain.destroyedCalls).toEqual(["gone"]);
    expect(domain.tokens.get("a")).toBe("a-now");
  });

  it("falls back to a full list when the server cannot calculate changes", async () => {
    const domain = fakeDomain({
      tokens: { a: "stale" },
      server: [{ id: "n1", scope: "a", version: "1" }],
      cache: [{ id: "old", scope: "a", createPending: false }],
      changes: { a: new Error("cannotCalculateChanges") },
    });
    const result = await runScopedInbound(["a"], domain.binding);
    expect(result).toEqual({ changed: true, usedFullResync: true });
    expect(domain.destroyedCalls).toEqual(["old"]);
    expect(domain.tokens.get("a")).toBe("a-now");
  });

  it("keeps an item that moved between scopes in one run", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1", b: "b1" },
      server: [{ id: "moved", scope: "b", version: "2" }],
      changes: {
        a: { ...noChanges("a2"), destroyed: ["moved"] },
        b: { ...noChanges("b2"), created: ["moved"] },
      },
    });
    await runScopedInbound(["a", "b"], domain.binding);
    expect(domain.ingested).toEqual(["moved"]);
    expect(domain.destroyedCalls).toEqual([]);
  });

  it("holds a scope's token while a skipped id will still be sent, and only that scope's", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1", b: "b1" },
      changes: {
        a: { ...noChanges("a2"), destroyed: ["queued-edit"] },
        b: { ...noChanges("b2"), destroyed: ["other"] },
      },
      pending: ["queued-edit"],
      blocking: ["queued-edit"],
    });
    const result = await runScopedInbound(["a", "b"], domain.binding);
    expect(domain.tokens.get("a")).toBe("a1");
    expect(domain.tokens.get("b")).toBe("b2");
    expect(result.changed).toBe(true);
  });

  it("advances the token when the skipped id waits for a person (not blocking)", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1" },
      changes: { a: { ...noChanges("a2"), destroyed: ["stuck"] } },
      pending: ["stuck"],
    });
    const result = await runScopedInbound(["a"], domain.binding);
    expect(domain.tokens.get("a")).toBe("a2");
    expect(result.changed).toBe(false);
  });

  it("does not report changed when every ingest was skipped", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1" },
      server: [{ id: "n1", scope: "a", version: "2" }],
      changes: { a: { ...noChanges("a2"), updated: ["n1"] } },
      pending: ["n1"],
      blocking: ["n1"],
    });
    const result = await runScopedInbound(["a"], domain.binding);
    expect(result).toEqual({ changed: false, usedFullResync: false });
    expect(domain.tokens.get("a")).toBe("a1");
  });

  it("treats a scope the server no longer has as gone, and keeps going", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1", b: "b1" },
      changes: { a: new Error("notFound"), b: noChanges("b2") },
    });
    const result = await runScopedInbound(["a", "b"], domain.binding);
    expect(domain.goneScopes).toEqual(["a"]);
    expect(result.changed).toBe(true);
    expect(domain.tokens.get("b")).toBe("b2");
  });

  it("writes nothing when a later scope's changes request fails", async () => {
    const domain = fakeDomain({
      tokens: { a: "a1", b: "b1" },
      server: [{ id: "n1", scope: "a", version: "1" }],
      cache: [],
      changes: { a: { ...noChanges("a2"), created: ["n1"] }, b: new Error("offline") },
    });
    await expect(runScopedInbound(["a", "b"], domain.binding)).rejects.toThrow("offline");
    expect(domain.ingested).toEqual([]);
    expect(Object.fromEntries(domain.tokens)).toEqual({ a: "a1", b: "b1" });
  });
});
