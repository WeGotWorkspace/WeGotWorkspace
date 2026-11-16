import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  parseOutboxPayload,
  runOutboxFlush,
  type OutboxFlushFailure,
} from "@/lib/offline/core/outbox-flush";
import { enqueueOutboxMutation, listOutboxMutations } from "@/lib/offline/core/outbox-store";

const username = "erin";
type Payload = { n: number };

async function queue(id: string, payload: string, domain = "demo"): Promise<void> {
  await enqueueOutboxMutation(username, { id, domain, op: "write", payload });
}

const parse = (row: Parameters<typeof parseOutboxPayload>[0]) =>
  parseOutboxPayload<Payload>(row, "demo");

describe("runOutboxFlush", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.clear();
  });

  it("sends a domain's rows oldest first and removes each sent row", async () => {
    await queue("a", '{"n":1}');
    await queue("other", '{"n":9}', "elsewhere");
    await queue("b", '{"n":2}');
    const sent: number[] = [];

    const counts = await runOutboxFlush<Payload>(username, {
      domain: "demo",
      parse,
      send: async (payload) => {
        sent.push(payload.n);
      },
    });

    expect(sent).toEqual([1, 2]);
    expect(counts).toEqual({ flushed: 2, failed: 0 });
    expect((await listOutboxMutations(username)).map((row) => row.id)).toEqual(["other"]);
  });

  it("sends the rows in the order the binding puts them", async () => {
    await queue("a", '{"n":1}');
    await queue("b", '{"n":2}');
    await queue("c", '{"n":3}');
    const sent: number[] = [];

    await runOutboxFlush<Payload>(username, {
      domain: "demo",
      order: (rows) => [...rows].reverse(),
      parse,
      send: async (payload) => {
        sent.push(payload.n);
      },
    });

    expect(sent).toEqual([3, 2, 1]);
  });

  it("records a failed send on its row, tells the binding, and goes on", async () => {
    await queue("a", '{"n":1}');
    await queue("b", '{"n":2}');
    const failures: OutboxFlushFailure[] = [];

    const counts = await runOutboxFlush<Payload>(username, {
      domain: "demo",
      parse,
      send: async (payload) => {
        if (payload.n === 1) throw Object.assign(new Error("refused"), { status: 403 });
      },
      onFailure: (failure) => {
        failures.push(failure);
      },
    });

    expect(counts).toEqual({ flushed: 1, failed: 1 });
    expect(failures.map((f) => [f.row.id, f.message, f.status])).toEqual([["a", "refused", 403]]);
    const [kept] = await listOutboxMutations(username);
    expect([kept?.id, kept?.lastError, kept?.lastStatus, kept?.retries]).toEqual([
      "a",
      "refused",
      403,
      1,
    ]);
  });

  it("drops a row it cannot read and leaves a row prepare holds back", async () => {
    await queue("broken", "{not json");
    await queue("held", '{"n":1}');
    const send = vi.fn(async () => undefined);

    const counts = await runOutboxFlush<Payload>(username, {
      domain: "demo",
      prepare: async (row) => (row.id === "held" ? null : row),
      parse,
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(counts).toEqual({ flushed: 0, failed: 0 });
    expect((await listOutboxMutations(username)).map((row) => [row.id, row.retries])).toEqual([
      ["held", 0],
    ]);
  });

  it("sends the row prepare answers", async () => {
    await queue("a", '{"n":1}');
    const send = vi.fn(async () => undefined);

    await runOutboxFlush<Payload>(username, {
      domain: "demo",
      prepare: async (row) => ({ ...row, payload: '{"n":5}' }),
      parse,
      send,
    });

    expect(send).toHaveBeenCalledWith(
      { n: 5 },
      expect.objectContaining({ id: "a" }),
      expect.anything(),
    );
  });

  it("leaves a row the binding handled itself, sent or failed", async () => {
    await queue("settled", '{"n":1}');
    await queue("refused", '{"n":2}');

    const counts = await runOutboxFlush<Payload>(username, {
      domain: "demo",
      parse,
      send: async (payload) => {
        if (payload.n === 2) throw new Error("conflict");
        return "handled";
      },
      onFailure: () => true,
    });

    expect(counts).toEqual({ flushed: 0, failed: 1 });
    const rows = await listOutboxMutations(username);
    expect(rows.map((row) => [row.id, row.retries, row.lastError])).toEqual([
      ["settled", 0, undefined],
      ["refused", 0, undefined],
    ]);
  });

  it("records a parse that throws as a failed send", async () => {
    await queue("a", "{not json");

    const counts = await runOutboxFlush<Payload>(username, {
      domain: "demo",
      parse: (row) => JSON.parse(row.payload) as Payload,
      send: async () => undefined,
    });

    expect(counts).toEqual({ flushed: 0, failed: 1 });
    const [kept] = await listOutboxMutations(username);
    expect([kept?.id, kept?.retries]).toEqual(["a", 1]);
  });

  it("sends a row again that changed while it was sent", async () => {
    await queue("a", '{"n":1}');
    const sent: number[] = [];

    await runOutboxFlush<Payload>(username, {
      domain: "demo",
      parse,
      send: async (payload, row, context) => {
        sent.push(payload.n);
        if (payload.n === 1) {
          context.resend({ kind: "changed", row: { ...row, payload: '{"n":2}' } });
          return "handled";
        }
      },
    });

    expect(sent).toEqual([1, 2]);
  });
});
