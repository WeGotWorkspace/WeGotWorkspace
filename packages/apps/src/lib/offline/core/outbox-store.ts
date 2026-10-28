import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
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
