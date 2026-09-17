import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import {
  listOutboxMutations,
  putOutboxMutation,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import {
  notesOutboxNoteId,
  removeNoteFromCache,
  upsertNoteInCache,
} from "@/lib/offline/notes-offline-store";
import {
  fetchServerNote,
  flushNotesOutbox,
  type OutboxFlushResult,
} from "@/lib/offline/notes-outbox-flush";

async function outboxRowsForNote(username: string, noteId: string) {
  const rows = await listOutboxMutations(username);
  return rows.filter((row) => notesOutboxNoteId(row) === noteId);
}

/**
 * "Keep mine": PATCH with the *new* server etag so local metadata overwrites.
 */
export async function resolveNotesConflictKeepLocal(
  username: string,
  noteId: string,
): Promise<OutboxFlushResult> {
  const fresh = await fetchServerNote(noteId);
  const rows = await outboxRowsForNote(username, noteId);
  for (const row of rows) {
    await putOutboxMutation(username, {
      ...row,
      ifInState: fresh.etag,
      retries: 0,
      lastError: undefined,
    });
  }

  return flushNotesOutbox(username);
}

/**
 * "Use server": discard queued local changes and refresh the cached note from the server.
 */
export async function resolveNotesConflictUseServer(
  username: string,
  noteId: string,
): Promise<void> {
  const rows = await outboxRowsForNote(username, noteId);
  for (const row of rows) {
    await removeOutboxMutation(username, row.id);
  }

  try {
    const fresh = await fetchServerNote(noteId);
    await upsertNoteInCache(username, fresh, false);
  } catch (error) {
    if (isFetchNetworkError(error)) throw error;
    await removeNoteFromCache(username, noteId);
  }
}
