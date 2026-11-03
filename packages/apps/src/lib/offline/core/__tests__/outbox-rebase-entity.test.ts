import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueOutboxMutation,
  listOutboxMutations,
  rebaseQueuedEntityRows,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

const username = "rebase-user";

function entityId(row: OfflineOutboxRow): string | null {
  return (JSON.parse(row.payload) as { id?: string }).id ?? null;
}

async function queue(id: string, domain: string, entity: string, ifInState?: string) {
  await enqueueOutboxMutation(username, {
    id,
    domain,
    op: "update",
    payload: JSON.stringify({ id: entity }),
    ifInState,
  });
}

describe("rebaseQueuedEntityRows", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.clear();
  });

  it("points the entity's other queued rows at the server answer", async () => {
    await queue("sent", "tasks", "local-1", "local-etag");
    await queue("later", "tasks", "local-1", "local-etag");
    await queue("other-entity", "tasks", "t2", "v9");
    await queue("other-domain", "notes", "local-1", "v9");

    const rebased = await rebaseQueuedEntityRows(username, {
      domain: "tasks",
      entityId: "local-1",
      sentRowId: "sent",
      entityIdFromRow: entityId,
      rebase: (row) => ({ ...row, payload: JSON.stringify({ id: "server-1" }), ifInState: "e1" }),
    });

    expect(rebased).toBe(1);
    const rows = await listOutboxMutations(username);
    expect(rows.map((row) => [row.id, entityId(row), row.ifInState])).toEqual([
      ["sent", "local-1", "local-etag"],
      ["later", "server-1", "e1"],
      ["other-entity", "t2", "v9"],
      ["other-domain", "local-1", "v9"],
    ]);
  });

  it("answers 0 when nothing else is queued for the entity", async () => {
    await queue("sent", "tasks", "t1", "v1");

    const rebased = await rebaseQueuedEntityRows(username, {
      domain: "tasks",
      entityId: "t1",
      sentRowId: "sent",
      entityIdFromRow: entityId,
      rebase: (row) => ({ ...row, ifInState: "v2" }),
    });

    expect(rebased).toBe(0);
    expect((await listOutboxMutations(username))[0]?.ifInState).toBe("v1");
  });
});
