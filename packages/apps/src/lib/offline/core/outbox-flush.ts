import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  listOutboxMutationsForDomain,
  markOutboxError,
  removeOutboxMutation,
  sendChangedRowAgain,
  type SentOutboxSettlement,
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
 * What `send` may answer instead of resolving plainly: `"handled"` when the
 * binding already settled, removed or marked the row itself (e.g. through
 * `settleSentOutboxMutation`, or a refusal it records its own way).
 */
export type OutboxSendOutcome = void | "handled";

export type OutboxFlushContext = {
  /**
   * A row that changed while it was sent (`settleSentOutboxMutation` answered
   * `changed`) is sent again later in this flush, up to `MAX_RESENDS_PER_FLUSH`.
   */
  resend: (settlement: SentOutboxSettlement) => void;
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
  /**
   * The row's payload, or null when it cannot be read: such a row is dropped.
   * A parse that throws counts as a failed send instead.
   */
  parse: (row: OfflineOutboxRow) => TPayload | null;
  /**
   * Sends one payload; resolving means the server took it and the runner
   * removes the row. Answer `"handled"` when the binding finished the row itself.
   */
  send: (
    payload: TPayload,
    row: OfflineOutboxRow,
    context: OutboxFlushContext,
  ) => Promise<OutboxSendOutcome>;
  /**
   * Sees every failed send. Answer true when the binding handled the row
   * itself (e.g. removed it, or recorded a conflict); otherwise the runner
   * records the error and status on the row.
   */
  onFailure?: (failure: OutboxFlushFailure) => boolean | void | Promise<boolean | void>;
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
  const resends = new Map<string, number>();
  const context: OutboxFlushContext = {
    resend: (settlement) => sendChangedRowAgain(rows, resends, settlement),
  };

  // `resend` appends to `rows`, so the loop reaches a row sent again.
  for (const listed of rows) {
    const row = binding.prepare ? await binding.prepare(listed) : listed;
    if (!row) continue;

    try {
      const payload = binding.parse(row);
      if (payload === null) {
        // Nothing can ever send it, and leaving it would hold the rows behind it.
        await removeOutboxMutation(username, row.id);
        continue;
      }
      if ((await binding.send(payload, row, context)) === "handled") continue;
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
      if ((await binding.onFailure?.(failure)) === true) continue;
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
