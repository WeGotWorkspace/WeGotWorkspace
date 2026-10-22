import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueCoalescedNoteUpdate,
  noteFromRow,
  noteRow,
} from "@/lib/offline/notes-offline-store";
import {
  adoptedNoteIdFor,
  markCreateInFlight,
  recordAdoptedNoteId,
} from "@/lib/offline/notes/notes-adopted-ids";
import { announceNoteAdoption } from "@/lib/offline/notes/notes-adoption-events";
import { baseUpdatedAt } from "@/lib/offline/notes/notes-metadata-selection";
import { isLocalTempNoteId, notesNotesTable } from "@/lib/offline/notes/notes-schema";

/**
 * Cache a new `local-*` note as pending and mark its create in flight, in one
 * transaction: a healer in another tab sees either no row or a marked row,
 * never a pending row it would create a second time.
 */
export async function writePendingLocalCreate(username: string, note: Note): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  await db.transaction("rw", [notes, db.meta], async () => {
    await markCreateInFlight(db, note.id);
    await notes.put(noteRow(note, true));
  });
}

/**
 * Cache `saved` from the server. When it was created from `localId`, also
 * record the mapping and drop the temp row, in the same transaction, then tell
 * the open Notes UI (this tab and others) so it swaps the temp row and id.
 *
 * A title typed while the create was in flight sits only on the temp row and
 * in a debounced save. When the server note has none, it moves onto the cached
 * server note and into the outbox, so a reload cannot lose it.
 */
export async function adoptServerNoteInCache(
  username: string,
  saved: Note,
  localId?: string,
): Promise<void> {
  const adoptedFrom = localId && localId !== saved.id ? localId : undefined;
  await writeAdoption(username, saved, adoptedFrom);
  if (adoptedFrom) announceNoteAdoption({ username, localId: adoptedFrom, serverId: saved.id });
}

async function writeAdoption(username: string, saved: Note, localId?: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  await db.transaction("rw", [notes, db.meta, db.outbox], async () => {
    if (!localId) {
      await notes.put(noteRow(saved, false));
      return;
    }
    const earlyTitle = noteFromRow(await notes.get(localId))?.title;
    await recordAdoptedNoteId(db, localId, saved.id);
    await notes.delete(localId);
    if (!earlyTitle?.trim() || saved.title?.trim()) {
      await notes.put(noteRow(saved, false));
      return;
    }
    const titled = { ...saved, title: earlyTitle };
    await notes.put(noteRow(titled, true));
    await enqueueCoalescedNoteUpdate(
      username,
      saved.id,
      titled,
      baseUpdatedAt(saved),
      undefined,
      undefined,
      { includeTitle: true },
    );
  });
}

/** Server id a `local-*` create was adopted as, or null. */
export async function adoptedServerNoteId(
  username: string,
  localId: string,
): Promise<string | null> {
  if (!isLocalTempNoteId(localId)) return null;
  return adoptedNoteIdFor(offlineDbForAccount(offlineAccountKeyFromUsername(username)), localId);
}
