import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

export type OutboxEntityIdFromRow = (row: OfflineOutboxRow) => string | null;

export type EnqueueCoalescedOutboxUpdateParams<TPatch> = {
  username: string;
  domain: string;
  /** Outbox verb to coalesce; defaults to `update`. */
  op?: string;
  entityId: string;
  patch: TPatch;
  ifInState?: string;
  mergePatches: (existing: TPatch, incoming: TPatch) => TPatch;
  entityIdFromRow: OutboxEntityIdFromRow;
  buildUpdatePayload: (entityId: string, patch: TPatch) => Record<string, unknown>;
  readPatchFromPayload: (payload: Record<string, unknown>) => TPatch;
};

/**
 * Queue an update mutation, merging into an existing pending update row for the
 * same domain entity when one exists. The original `ifInState` is preserved.
 * The row may be on its way to the server: the flush only removes it when it
 * is unchanged since it was read, so a merged edit is sent again.
 */
export async function enqueueCoalescedOutboxUpdate<TPatch>(
  params: EnqueueCoalescedOutboxUpdateParams<TPatch>,
): Promise<void> {
  const {
    username,
    domain,
    op = "update",
    entityId,
    patch,
    ifInState,
    mergePatches,
    entityIdFromRow,
    buildUpdatePayload,
    readPatchFromPayload,
  } = params;

  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  // One transaction, so a flush settling the same row runs before or after
  // this merge, never in between (see `settleSentOutboxMutation`).
  await db.transaction("rw", db.outbox, async () => {
    const rows = await db.outbox.where("domain").equals(domain).sortBy("createdAt");
    const existing = rows.find((row) => row.op === op && entityIdFromRow(row) === entityId);

    if (existing) {
      const parsed = JSON.parse(existing.payload) as Record<string, unknown>;
      const mergedPatch = mergePatches(readPatchFromPayload(parsed), patch);
      await db.outbox.put({
        ...existing,
        payload: JSON.stringify(buildUpdatePayload(entityId, mergedPatch)),
      });
      return;
    }

    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain,
      op,
      payload: JSON.stringify(buildUpdatePayload(entityId, patch)),
      ifInState,
    });
  });
}
