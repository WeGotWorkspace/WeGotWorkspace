import { listFailedContactOutbox } from "@/lib/offline/contacts/contacts-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/core/use-failed-outbox-count";

/**
 * Count of outbox rows that failed to sync for a transient (non-conflict)
 * reason. Drives the retry notice. Refreshes on connectivity changes, when
 * `refreshKey` changes, and on a light poll so the notice clears once a retry
 * succeeds.
 */
export function useContactsFailedSync(
  username: string | null | undefined,
  refreshKey?: number,
): number {
  return useFailedOutboxCount(username, listFailedContactOutbox, refreshKey).count;
}
