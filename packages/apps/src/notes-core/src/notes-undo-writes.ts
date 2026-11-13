import { settleAll, type CompletedWriteKeys } from "@/hooks/use-queued-mutation";
import type { Note } from "@/lib/models/note";
import {
  persistNoteKeepingSyncRace,
  persistNoteOrDropGone,
} from "@/notes-core/src/notes-persist-access";
import type { NoteMetadataField, NotesAPIOperations } from "@/lib/models/notes-types";

/**
 * Server writes for Notes actions and their Undo (#1854). Every write sends a delta: one
 * field, a tag added or removed, or the archive status. Never the whole note, so an Undo
 * does not wipe what someone else changed in the meantime.
 */

type OnGone = (noteId: string) => void;
/** Undefined in the offline-only mock: nothing goes to a server. */
type Operations = NotesAPIOperations | undefined;
type MarkCompleted = (noteId: string) => void;
type TagDelta = { tagsAdd?: string[]; tagsRemove?: string[] };

/** The rows the server applied: all of them, or the ids a batch marked as done. */
export function completedRows<T extends { id: string } | string>(
  rows: readonly T[],
  completed: CompletedWriteKeys,
): T[] {
  const idOf = (row: T) => (typeof row === "string" ? row : row.id);
  return completed ? rows.filter((row) => completed.has(idOf(row))) : [...rows];
}

/**
 * Sends `fields` of each row (each row holds the value to send). On a revert the rows hold
 * the value from before the change.
 */
export function sendNoteFields(
  operations: Operations,
  rows: readonly Note[],
  fields: NoteMetadataField[],
  onGone: OnGone,
  markCompleted?: MarkCompleted,
): Promise<void> {
  if (!operations) return Promise.resolve();
  return settleAll(
    rows.map(async (row) => {
      await persistNoteOrDropGone(operations.upsertNote(row, { fields }), () => onGone(row.id));
      markCompleted?.(row.id);
    }),
  ).then(() => undefined);
}

/**
 * Adds or removes tags on each row. A row is marked done only when the server returned the
 * note (or it is gone). A lost 412 sync race rejects, so the write fails and Undo never sends
 * the inverse for a write that did not land.
 */
export function sendTagDelta(
  operations: Operations,
  rows: readonly Note[],
  delta: TagDelta,
  onGone: OnGone,
  markCompleted?: MarkCompleted,
): Promise<void> {
  if (!operations) return Promise.resolve();
  return settleAll(
    rows.map(async (row) => {
      let gone = false;
      const saved = await persistNoteKeepingSyncRace(
        operations.upsertNote(row, delta),
        () => {
          gone = true;
          onGone(row.id);
        },
        row.id,
      );
      if (!saved && !gone) throw new Error(`Tag change for note ${row.id} lost a sync race`);
      markCompleted?.(row.id);
    }),
  ).then(() => undefined);
}

/** The opposite tag edit, for Undo. */
export function inverseTagDelta({ tagsAdd, tagsRemove }: TagDelta): TagDelta {
  return {
    ...(tagsRemove?.length ? { tagsAdd: tagsRemove } : {}),
    ...(tagsAdd?.length ? { tagsRemove: tagsAdd } : {}),
  };
}

/**
 * Archives or restores each note. Returns the server rows (undefined when a note is gone).
 * Offline, a queued archive of the same note is turned around in place (see
 * `queueArchiveState`), so Undo does not leave two rows in the outbox.
 */
export function sendArchiveState(
  operations: Operations,
  ids: readonly string[],
  archived: boolean,
  onGone: OnGone,
  markCompleted?: MarkCompleted,
): Promise<(Note | undefined)[]> {
  if (!operations) return Promise.resolve([]);
  return settleAll(
    ids.map(async (id) => {
      const saved = await persistNoteOrDropGone(
        archived ? operations.archiveNote(id) : operations.restoreNote(id),
        () => onGone(id),
      );
      markCompleted?.(id);
      return saved;
    }),
  );
}
