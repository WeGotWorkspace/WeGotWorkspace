import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueOutboxMutation,
  isRetryableOutboxRow,
  listOutboxMutations,
  listOutboxMutationsForDomain,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const username = "outbox-user";

describe("core outbox store", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("enqueues with createdAt/retries defaults and lists oldest first", async () => {
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: "contacts",
      op: "update",
      payload: "{}",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueueOutboxMutation(username, {
      id: "b",
      domain: "notes",
      op: "create",
      payload: "{}",
    });

    const rows = await listOutboxMutations(username);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]?.retries).toBe(0);
    expect(typeof rows[0]?.createdAt).toBe("number");
    expect(rows[1]?.createdAt).toBeGreaterThan(rows[0]?.createdAt ?? 0);
  });

  it("filters by domain", async () => {
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: "contacts",
      op: "update",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "b",
      domain: "notes",
      op: "create",
      payload: "{}",
    });

    const contacts = await listOutboxMutationsForDomain(username, "contacts");
    expect(contacts.map((r) => r.id)).toEqual(["a"]);
  });

  it("records errors, increments retries, and removes rows", async () => {
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: "contacts",
      op: "update",
      payload: "{}",
    });
    await markOutboxError(username, "a", "boom");
    await markOutboxError(username, "a", "boom again");

    const [row] = await listOutboxMutations(username);
    expect(row?.retries).toBe(2);
    expect(row?.lastError).toBe("boom again");
    expect(isRetryableOutboxRow(row!)).toBe(true);

    await removeOutboxMutation(username, "a");
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("does not flag conflicts or fresh rows as retryable", async () => {
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: "contacts",
      op: "update",
      payload: "{}",
    });
    const [fresh] = await listOutboxMutations(username);
    expect(isRetryableOutboxRow(fresh!)).toBe(false);

    await markOutboxError(username, "a", "stateMismatch");
    const [conflicted] = await listOutboxMutations(username);
    expect(isRetryableOutboxRow(conflicted!)).toBe(false);
  });
});
