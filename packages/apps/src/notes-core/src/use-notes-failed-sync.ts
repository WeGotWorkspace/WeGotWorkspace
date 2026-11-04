import { listFailedNotesOutbox } from "@/lib/offline/notes-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/use-failed-outbox-count";

/**
 * Transient outbox failures plus metadata sync conflicts the listener reported.
 * Conflict ids are separate from `listFailedNotesOutbox`: a `stateMismatch` row
 * is not retryable, and a JMAP collision never writes an outbox error.
 */
export function useNotesFailedSync(
  username: string | null | undefined,
  refreshKey?: number,
  conflictNoteIds?: readonly string[],
): number {
  const { count } = useFailedOutboxCount(username, listFailedNotesOutbox, refreshKey);
  return count + (conflictNoteIds?.length ?? 0);
}
