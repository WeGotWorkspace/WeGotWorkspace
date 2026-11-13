import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  listOutboxMutationsForDomain,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

/** A failed send as the flush recorded it on the row. */
export type OutboxFlushFailure = {
  row: OfflineOutboxRow;
  error: unknown;
  message: string;
  status: number | undefined;
};

/**
 * One domain's part of an outbox flush (#1565). The runner lists the domain's
 * rows oldest first, sends them one by one, removes a sent row and records a
 * failed one; the binding only knows how to send its own payloads.
 *
 * The runner takes no lock: callers flush under the cross-tab outbox lock
 * (`ConnectivitySyncRunnerRegistry`, conflict resolution).
 */
export type OutboxFlushBinding<TPayload> = {
  domain: string;
  /**
   * Runs before the row is read. Answers the row to send (it may rewrite it),
   * or null to leave the row as it is for a later flush.
   */
  prepare?: (row: OfflineOutboxRow) => Promise<OfflineOutboxRow | null>;
  /** The row's payload, or null when it cannot be read: such a row is dropped. */
  parse: (row: OfflineOutboxRow) => TPayload | null;
  /** Sends one payload; resolving means the server took it. */
  send: (payload: TPayload, row: OfflineOutboxRow) => Promise<void>;
  /**
   * Sees every failed send before the row records it, e.g. to collect the
   * paths whose write hit a precondition.
   */
  onFailure?: (failure: OutboxFlushFailure) => void | Promise<void>;
};

export type OutboxFlushCounts = {
  /** Rows the server took (and that left the outbox). */
  flushed: number;
  /** Rows whose send failed; each keeps its error and status for the notices. */
  failed: number;
};

export async function runOutboxFlush<TPayload>(
  username: string,
  binding: OutboxFlushBinding<TPayload>,
): Promise<OutboxFlushCounts> {
  const rows = await listOutboxMutationsForDomain(username, binding.domain);
  const counts: OutboxFlushCounts = { flushed: 0, failed: 0 };

  for (const listed of rows) {
    const row = binding.prepare ? await binding.prepare(listed) : listed;
    if (!row) continue;
    const payload = binding.parse(row);
    if (payload === null) {
      // Nothing can ever send it, and leaving it would hold the rows behind it.
      await removeOutboxMutation(username, row.id);
      continue;
    }

    try {
      await binding.send(payload, row);
      await removeOutboxMutation(username, row.id);
      counts.flushed += 1;
    } catch (error) {
      counts.failed += 1;
      const failure: OutboxFlushFailure = {
        row,
        error,
        message: error instanceof Error ? error.message : String(error),
        status: httpStatusFromFlushError(error),
      };
      await binding.onFailure?.(failure);
      await markOutboxError(username, row.id, failure.message, failure.status);
    }
  }

  return counts;
}

/** Parses a row of `domain` as JSON, or null for another domain or unreadable JSON. */
export function parseOutboxPayload<TPayload>(
  row: OfflineOutboxRow,
  domain: string,
): TPayload | null {
  if (row.domain !== domain) return null;
  try {
    return JSON.parse(row.payload) as TPayload;
  } catch {
    return null;
  }
}
