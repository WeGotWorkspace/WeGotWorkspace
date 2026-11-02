import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  MAX_RESENDS_PER_FLUSH,
  enqueueOutboxMutation,
  getOutboxMutation,
  putOutboxMutation,
  sendChangedRowAgain,
  settleSentOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

const username = "settle-user";

async function queued(): Promise<OfflineOutboxRow> {
  await enqueueOutboxMutation(username, {
    id: "row-1",
    domain: "tasks",
    op: "update",
    payload: JSON.stringify({ taskId: "t1", patch: { title: "A" } }),
    ifInState: "v1",
  });
  return (await getOutboxMutation(username, "row-1"))!;
}

describe("settleSentOutboxMutation (#1711)", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.clear();
  });

  it("removes an unchanged row and caches the answer", async () => {
    const sent = await queued();
    const onRemoved = vi.fn(async () => {});
    const onChanged = vi.fn(async () => {});

    const settlement = await settleSentOutboxMutation(username, sent, { onRemoved, onChanged });

    expect(settlement).toEqual({ kind: "removed" });
    expect(await getOutboxMutation(username, "row-1")).toBeUndefined();
    expect(onRemoved).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps and rebases a row an edit was merged into meanwhile", async () => {
    const sent = await queued();
    const merged = { ...sent, payload: JSON.stringify({ taskId: "t1", patch: { title: "B" } }) };
    await putOutboxMutation(username, merged);
    const onRemoved = vi.fn(async () => {});

    const settlement = await settleSentOutboxMutation(username, sent, {
      rebase: (row) => ({ ...row, ifInState: "v2" }),
      onRemoved,
    });

    expect(settlement).toEqual({ kind: "changed", row: { ...merged, ifInState: "v2" } });
    expect(await getOutboxMutation(username, "row-1")).toEqual({ ...merged, ifInState: "v2" });
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("reports a row someone else removed and caches nothing", async () => {
    const sent = await queued();
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.delete(sent.id);
    const onRemoved = vi.fn(async () => {});

    expect(await settleSentOutboxMutation(username, sent, { onRemoved })).toEqual({
      kind: "missing",
    });
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("sends a changed row again a bounded number of times per flush", async () => {
    const row = await queued();
    const rows: OfflineOutboxRow[] = [];
    const resends = new Map<string, number>();
    for (let attempt = 0; attempt < MAX_RESENDS_PER_FLUSH + 2; attempt += 1) {
      sendChangedRowAgain(rows, resends, { kind: "changed", row });
    }
    sendChangedRowAgain(rows, resends, { kind: "removed" });

    expect(rows).toHaveLength(MAX_RESENDS_PER_FLUSH);
  });
});
