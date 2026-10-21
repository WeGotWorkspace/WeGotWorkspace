import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueCoalescedNoteUpdate,
  getNoteFromCache,
  listOutboxMutations,
  listPendingNoteIds,
  notesOutboxNoteId,
  removeNoteFromCache,
  upsertNoteInCache,
} from "@/lib/offline/notes-offline-store";
import { isLocalTempNoteId } from "@/lib/offline/notes/notes-schema";
import { adoptedNoteIdFor, isCreateInFlight } from "@/lib/offline/notes/notes-adopted-ids";
import { baseUpdatedAt, metadataSelection } from "@/lib/offline/notes/notes-metadata-selection";

/**
 * A pending `local-*` row whose create the server already accepted. Only a
 * title the server never got is carried over, as a PATCH on the server note:
 * tag and star writes on a `local-*` id wait for the create and reach the
 * server id, and the stale snapshot must not overwrite newer server values.
 */
async function foldAdoptedLocalNote(
  username: string,
  local: Note,
  serverId: string,
  liveNotes: readonly Note[],
): Promise<void> {
  // The cache can miss the server note (a stale snapshot was written), so
  // the live payload counts too. Only a note missing from both was deleted
  // on the server, and then dropping the row with its title is deliberate.
  const server =
    (await getNoteFromCache(username, serverId)) ??
    liveNotes.find((note) => note.id === serverId) ??
    null;
  if (server && local.title?.trim() && !server.title?.trim()) {
    const folded: Note = { ...server, title: local.title };
    await upsertNoteInCache(username, folded, true);
    await enqueueCoalescedNoteUpdate(
      username,
      serverId,
      folded,
      baseUpdatedAt(server),
      undefined,
      undefined,
      metadataSelection(server, folded, false),
    );
  }
  await removeNoteFromCache(username, local.id);
}

/**
 * Heal pending local-* rows that have no outbox. An adopted id folds onto its
 * server note; any other row is queued so flush can POST it. `liveNotes` is
 * the server's current list, fetched before this runs.
 */
export async function enqueueOrphanPendingLocalCreates(
  username: string,
  liveNotes: readonly Note[],
): Promise<void> {
  const pendingIds = await listPendingNoteIds(username);
  if (pendingIds.length === 0) return;
  const queued = new Set(
    (await listOutboxMutations(username))
      .map((row) => notesOutboxNoteId(row))
      .filter((id): id is string => !!id),
  );
  for (const id of pendingIds) {
    if (!isLocalTempNoteId(id) || queued.has(id)) continue;
    const note = await getNoteFromCache(username, id);
    if (!note) continue;
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const serverId = await adoptedNoteIdFor(db, id);
    if (serverId) {
      await foldAdoptedLocalNote(username, note, serverId, liveNotes);
      continue;
    }
    // Its POST is still out, maybe in another tab (see markCreateInFlight).
    if (await isCreateInFlight(db, id)) continue;
    await enqueueCoalescedNoteUpdate(username, note.id, note, baseUpdatedAt(note), note.id);
  }
}
