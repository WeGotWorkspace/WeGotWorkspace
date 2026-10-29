import type { Table } from "dexie";
import {
  offlineAccountKeyFromUsername,
  offlineDbForAccount,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

/** Append a mutation to the account outbox. `createdAt`/`retries` are managed here. */
export async function enqueueOutboxMutation(
  username: string,
  row: Omit<OfflineOutboxRow, "createdAt" | "retries">,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const newest = await db.outbox.orderBy("createdAt").last();
  await db.outbox.put({
    ...row,
    createdAt: Math.max(Date.now(), (newest?.createdAt ?? 0) + 1),
    retries: 0,
  });
}

/** All queued mutations for an account, oldest first. */
export async function listOutboxMutations(username: string): Promise<OfflineOutboxRow[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.outbox.orderBy("createdAt").toArray();
}

/** Queued mutations for a single domain, oldest first. */
export async function listOutboxMutationsForDomain(
  username: string,
  domain: string,
): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutations(username);
  return rows.filter((row) => row.domain === domain);
}

export async function getOutboxMutation(
  username: string,
  id: string,
): Promise<OfflineOutboxRow | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.outbox.get(id);
}

export async function putOutboxMutation(username: string, row: OfflineOutboxRow): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.outbox.put(row);
}

export async function removeOutboxMutation(username: string, id: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.outbox.delete(id);
}

/** What became of a row the flush has just sent. */
export type SentOutboxSettlement =
  /** Unchanged since the flush read it: removed. */
  | { kind: "removed" }
  /** An edit was merged in while the request was on its way: still queued. */
  | { kind: "changed"; row: OfflineOutboxRow }
  /** Someone else removed it meanwhile (a delete dropped the entity's rows). */
  | { kind: "missing" };

function sameMutation(left: OfflineOutboxRow, right: OfflineOutboxRow): boolean {
  return (
    left.op === right.op && left.payload === right.payload && left.ifInState === right.ifInState
  );
}

export type SettleSentOutboxOptions = {
  /** Turns the still-queued row into what is owed, e.g. the answer's concurrency token. */
  rebase?: (row: OfflineOutboxRow) => OfflineOutboxRow;
  /** Cache tables the callbacks write; they join the same transaction. */
  cacheTables?: (db: WgwOfflineDatabase) => Table[];
  /** Cache the server's answer: nothing newer is queued. */
  onRemoved?: () => Promise<void>;
  /** A newer edit is queued: the cache keeps that local copy. */
  onChanged?: (row: OfflineOutboxRow) => Promise<void>;
};

/**
 * Settle a row the server accepted. It is removed only when it is unchanged
 * since `sent` was read. An edit coalesced into it while the request was on
 * its way stays queued, so it is sent too, and the server's older answer is
 * not cached over it (#1711). One transaction covers the outbox and the
 * cache, so a write that caches and queues together lands before or after.
 */
export async function settleSentOutboxMutation(
  username: string,
  sent: OfflineOutboxRow,
  options: SettleSentOutboxOptions = {},
): Promise<SentOutboxSettlement> {
  const { rebase, cacheTables, onRemoved, onChanged } = options;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const tables = [db.outbox, ...(cacheTables?.(db) ?? [])];
  return db.transaction("rw", tables, async (): Promise<SentOutboxSettlement> => {
    const current = await db.outbox.get(sent.id);
    if (!current) return { kind: "missing" };
    if (sameMutation(current, sent)) {
      await db.outbox.delete(sent.id);
      await onRemoved?.();
      return { kind: "removed" };
    }
    const row = rebase ? rebase(current) : current;
    if (row !== current) await db.outbox.put(row);
    await onChanged?.(row);
    return { kind: "changed", row };
  });
}

/** How often one row is sent again in a flush because edits kept arriving. */
export const MAX_RESENDS_PER_FLUSH = 5;

/**
 * Put a row that changed while it was sent at the end of `rows`, so the
 * running flush (a `for...of` over `rows`) sends it too: online, nothing else
 * would start the next flush. `resends` counts per row id for this flush.
 */
export function sendChangedRowAgain(
  rows: OfflineOutboxRow[],
  resends: Map<string, number>,
  settlement: SentOutboxSettlement,
): void {
  if (settlement.kind !== "changed") return;
  const count = resends.get(settlement.row.id) ?? 0;
  if (count >= MAX_RESENDS_PER_FLUSH) return;
  resends.set(settlement.row.id, count + 1);
  rows.push(settlement.row);
}

/**
 * Increment the retry count and record the last error. A numeric `status`
 * replaces `lastStatus`. A later failure with no status leaves an existing
 * `lastStatus` untouched: absence of a status is not a retraction of a status
 * the server already gave. A first failure with no status still has no
 * `lastStatus`.
 */
export async function markOutboxError(
  username: string,
  id: string,
  error: string,
  status?: number,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.outbox.get(id);
  if (!row) return;
  const next: OfflineOutboxRow = {
    ...row,
    retries: row.retries + 1,
    lastError: error,
  };
  if (typeof status === "number") next.lastStatus = status;
  await db.outbox.put(next);
}

/** Every conflict spelling flush paths write. */
export const CONFLICT_OUTBOX_ERRORS = new Set(["stateMismatch", "conflict", "etagMismatch"]);

/** Conflict markers that can still carry a permanent server status. */
export const STATUS_BEARING_CONFLICTS = new Set(["conflict"]);

/**
 * Conflict rows are not transient retries. Flush paths spell that three ways:
 * `"stateMismatch"`, `"conflict"`, and `"etagMismatch"`.
 */
function isFailedNonConflict(row: OfflineOutboxRow): boolean {
  return (
    row.retries > 0 && Boolean(row.lastError) && !CONFLICT_OUTBOX_ERRORS.has(row.lastError ?? "")
  );
}

/**
 * 403 and 404 from `lastStatus`. Rows written before that column exist fall
 * back to the Docs/Drive flush text `failed (403)` or `failed (404)`. Any
 * stored status that is not 403 or 404 is transient, even when the text matches.
 */
function isPermanentOutboxFailure(row: OfflineOutboxRow): boolean {
  if (typeof row.lastStatus === "number") {
    return row.lastStatus === 403 || row.lastStatus === 404;
  }
  // eslint-disable-next-line no-restricted-syntax -- allowlisted (#1642): pre-`lastStatus` rows only
  return /failed \((?:403|404)\)/.test(row.lastError ?? "");
}

/**
 * True when a row failed for a non-conflict, transient reason (eligible for retry).
 * Permanent 403 and 404 rejections are `isPermanentlyFailedOutboxRow`, not this.
 */
export function isRetryableOutboxRow(row: OfflineOutboxRow): boolean {
  return isFailedNonConflict(row) && !isPermanentOutboxFailure(row);
}

/**
 * True when the server rejected the mutation with HTTP 403 or 404.
 * These stay visible in the sync notices. They are not transient retries.
 * `stateMismatch` and `etagMismatch` are excluded because they are conflict
 * markers that must not carry a permanent status, while `"conflict"` can.
 */
export function isPermanentlyFailedOutboxRow(row: OfflineOutboxRow): boolean {
  if (isFailedNonConflict(row)) return isPermanentOutboxFailure(row);
  if (!(row.retries > 0 && STATUS_BEARING_CONFLICTS.has(row.lastError ?? ""))) return false;
  return isPermanentOutboxFailure(row);
}

/**
 * Rows a sync notice lists: transient retries and permanent 403/404 rejections.
 * Revision conflicts stay on the conflict channel. Docs, Drive, Calendar,
 * Contacts, Notes, and Tasks use this.
 */
export function isSyncNoticeOutboxRow(row: OfflineOutboxRow): boolean {
  return isRetryableOutboxRow(row) || isPermanentlyFailedOutboxRow(row);
}
