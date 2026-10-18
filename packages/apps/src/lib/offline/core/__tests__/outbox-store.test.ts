import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  CONFLICT_OUTBOX_ERRORS,
  STATUS_BEARING_CONFLICTS,
  enqueueOutboxMutation,
  isPermanentlyFailedOutboxRow,
  isRetryableOutboxRow,
  isSyncNoticeOutboxRow,
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
    const [firstFailure] = await listOutboxMutations(username);
    expect(firstFailure?.lastStatus).toBeUndefined();
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
    expect(isPermanentlyFailedOutboxRow(conflicted!)).toBe(false);
    expect(isSyncNoticeOutboxRow(conflicted!)).toBe(false);

    await enqueueOutboxMutation(username, {
      id: "calendar-conflict",
      domain: "calendars",
      op: "update",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "calendar-gone",
      domain: "calendars",
      op: "update",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "task-etag",
      domain: "tasks",
      op: "update",
      payload: "{}",
    });
    await markOutboxError(username, "calendar-conflict", "conflict");
    await markOutboxError(username, "calendar-gone", "conflict", 404);
    await markOutboxError(username, "task-etag", "etagMismatch");

    const byId = Object.fromEntries(
      (await listOutboxMutations(username)).map((row) => [row.id, row]),
    );
    expect(isRetryableOutboxRow(byId["calendar-conflict"]!)).toBe(false);
    expect(isPermanentlyFailedOutboxRow(byId["calendar-conflict"]!)).toBe(false);
    expect(isSyncNoticeOutboxRow(byId["calendar-conflict"]!)).toBe(false);
    expect(isRetryableOutboxRow(byId["calendar-gone"]!)).toBe(false);
    expect(isPermanentlyFailedOutboxRow(byId["calendar-gone"]!)).toBe(true);
    expect(isSyncNoticeOutboxRow(byId["calendar-gone"]!)).toBe(true);
    expect(byId["calendar-gone"]?.lastStatus).toBe(404);
    expect(isRetryableOutboxRow(byId["task-etag"]!)).toBe(false);
    expect(isPermanentlyFailedOutboxRow(byId["task-etag"]!)).toBe(false);
    expect(byId["task-etag"]?.lastStatus).toBeUndefined();
  });

  it("treats permanence as the status-bearing difference of conflict spellings", async () => {
    expect(
      [...STATUS_BEARING_CONFLICTS].filter((spelling) => !CONFLICT_OUTBOX_ERRORS.has(spelling)),
    ).toEqual([]);

    for (const spelling of CONFLICT_OUTBOX_ERRORS) {
      await enqueueOutboxMutation(username, {
        id: `spell-${spelling}`,
        domain: "docs",
        op: "rename",
        payload: "{}",
      });
      await markOutboxError(username, `spell-${spelling}`, spelling, 404);
    }

    await enqueueOutboxMutation(username, {
      id: "conflict-no-status",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await markOutboxError(username, "conflict-no-status", "conflict");

    const byId = Object.fromEntries(
      (await listOutboxMutations(username)).map((row) => [row.id, row]),
    );

    for (const spelling of CONFLICT_OUTBOX_ERRORS) {
      const row = byId[`spell-${spelling}`]!;
      expect(row.lastStatus).toBe(404);
      expect(isPermanentlyFailedOutboxRow(row)).toBe(STATUS_BEARING_CONFLICTS.has(spelling));
      expect(isRetryableOutboxRow(row)).toBe(false);
    }

    const plain = byId["conflict-no-status"]!;
    expect(plain.lastStatus).toBeUndefined();
    expect(isPermanentlyFailedOutboxRow(plain)).toBe(false);
    expect(isSyncNoticeOutboxRow(plain)).toBe(false);
  });

  it("splits transient retries from permanent 403 and 404 rejections", async () => {
    await enqueueOutboxMutation(username, {
      id: "transient",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "missing",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "forbidden",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await markOutboxError(username, "transient", "network down");
    await markOutboxError(username, "missing", "GET failed (404)");
    await markOutboxError(username, "forbidden", "PATCH failed (403)");

    const rows = await listOutboxMutations(username);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(isRetryableOutboxRow(byId.transient!)).toBe(true);
    expect(isPermanentlyFailedOutboxRow(byId.transient!)).toBe(false);
    expect(isRetryableOutboxRow(byId.missing!)).toBe(false);
    expect(isPermanentlyFailedOutboxRow(byId.missing!)).toBe(true);
    expect(isPermanentlyFailedOutboxRow(byId.forbidden!)).toBe(true);
    expect(isSyncNoticeOutboxRow(byId.transient!)).toBe(true);
    expect(isSyncNoticeOutboxRow(byId.missing!)).toBe(true);
    expect(isSyncNoticeOutboxRow(byId.forbidden!)).toBe(true);

    await enqueueOutboxMutation(username, {
      id: "path-404",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await markOutboxError(username, "path-404", "could not write notes/404.md");
    const [loose] = (await listOutboxMutations(username)).filter((row) => row.id === "path-404");
    expect(isRetryableOutboxRow(loose!)).toBe(true);
    expect(isPermanentlyFailedOutboxRow(loose!)).toBe(false);
    expect(isSyncNoticeOutboxRow(loose!)).toBe(true);
    expect(loose?.lastStatus).toBeUndefined();
  });

  it("prefers lastStatus over the flush text", async () => {
    await enqueueOutboxMutation(username, {
      id: "card",
      domain: "contacts",
      op: "update",
      payload: "{}",
    });
    await enqueueOutboxMutation(username, {
      id: "retry",
      domain: "drive",
      op: "upload",
      payload: "{}",
    });
    await markOutboxError(username, "card", "ContactCard/get did not return card-1", 404);
    await markOutboxError(username, "retry", "GET failed (404)", 500);

    const rows = await listOutboxMutations(username);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.card?.lastStatus).toBe(404);
    expect(isPermanentlyFailedOutboxRow(byId.card!)).toBe(true);
    expect(isRetryableOutboxRow(byId.card!)).toBe(false);
    expect(byId.retry?.lastStatus).toBe(500);
    expect(isPermanentlyFailedOutboxRow(byId.retry!)).toBe(false);
    expect(isRetryableOutboxRow(byId.retry!)).toBe(true);

    await markOutboxError(username, "card", "network down");
    const kept = (await listOutboxMutations(username)).find((row) => row.id === "card");
    expect(kept?.lastStatus).toBe(404);
    expect(isPermanentlyFailedOutboxRow(kept!)).toBe(true);
    expect(isRetryableOutboxRow(kept!)).toBe(false);
  });

  it("keeps a known permanent status across a later status-less failure", async () => {
    await enqueueOutboxMutation(username, {
      id: "doc",
      domain: "docs",
      op: "rename",
      payload: "{}",
    });
    await markOutboxError(username, "doc", "missing", 404);
    await markOutboxError(username, "doc", "network down");

    const kept = (await listOutboxMutations(username)).find((row) => row.id === "doc");
    expect(kept?.lastError).toBe("network down");
    expect(kept?.lastStatus).toBe(404);
    expect(isPermanentlyFailedOutboxRow(kept!)).toBe(true);

    await markOutboxError(username, "doc", "server error", 500);
    const replaced = (await listOutboxMutations(username)).find((row) => row.id === "doc");
    expect(replaced?.lastStatus).toBe(500);
    expect(isPermanentlyFailedOutboxRow(replaced!)).toBe(false);
    expect(isRetryableOutboxRow(replaced!)).toBe(true);
  });
});
