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

/** Increment retry count and record the last error message for a queued mutation. */
export async function markOutboxError(username: string, id: string, error: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.outbox.get(id);
  if (!row) return;
  await db.outbox.put({
    ...row,
    retries: row.retries + 1,
    lastError: error,
  });
}

function isFailedNonConflict(row: OfflineOutboxRow): boolean {
  return row.retries > 0 && Boolean(row.lastError) && row.lastError !== "stateMismatch";
}

/** Server rejected the mutation. Matches `failed (404)` / `failed (403)` style messages. */
function isPermanentOutboxFailure(lastError: string): boolean {
  return /\b(?:403|404)\b/.test(lastError);
}

/**
 * True when a row failed for a non-conflict, transient reason (eligible for retry).
 * Permanent 403 and 404 rejections are `isPermanentlyFailedOutboxRow`, not this.
 */
export function isRetryableOutboxRow(row: OfflineOutboxRow): boolean {
  return isFailedNonConflict(row) && !isPermanentOutboxFailure(row.lastError ?? "");
}

/**
 * True when the server rejected the mutation with 403 or 404.
 * These stay visible in the Docs and Drive sync notice. They are not transient
 * retries and they are not revision conflicts (`stateMismatch`).
 */
export function isPermanentlyFailedOutboxRow(row: OfflineOutboxRow): boolean {
  return isFailedNonConflict(row) && isPermanentOutboxFailure(row.lastError ?? "");
}

/**
 * Rows the Docs and Drive sync notice lists: transient retries and permanent
 * 403/404 rejections. Revision conflicts stay on the conflict channel.
 */
export function isSyncNoticeOutboxRow(row: OfflineOutboxRow): boolean {
  return isRetryableOutboxRow(row) || isPermanentlyFailedOutboxRow(row);
}
