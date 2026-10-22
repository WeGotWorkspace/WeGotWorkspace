import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  enqueueCoalescedNoteUpdate,
  noteFromRow,
  noteRow,
} from "@/lib/offline/notes-offline-store";
import { migrateNoteCollabRoom } from "@/lib/offline/notes/notes-collab-rooms";
import { NOTES_DOMAIN, notesNotesTable } from "@/lib/offline/notes/notes-schema";

/**
 * Before the app picked note UIDs itself, a note made offline got a
 * temporary `local-<32 hex>` id that the server later replaced. Such notes
 * can still sit unsynced in a browser after an upgrade. This rewrites them
 * once to a real UUID (the same hex, so a retried create stays idempotent)
 * and queues their create, so nothing else has to know `local-*` ids.
 */
const LEGACY_PREFIX = "local-";
const LEGACY_META_PREFIXES = ["notes:adoptedId:", "notes:createInFlight:"];

export function isLegacyLocalNoteId(id: string | undefined): boolean {
  return !!id?.startsWith(LEGACY_PREFIX);
}

export function uuidFromLegacyLocalId(id: string): string {
  const hex = id
    .slice(LEGACY_PREFIX.length)
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase();
  if (hex.length !== 32) return crypto.randomUUID();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A queued row's payload, or null when it is not JSON (the store skips those). */
function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function upgradeLegacyLocalNotes(username: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const notes = notesNotesTable(db);
  const rows = await notes.filter((row) => isLegacyLocalNoteId(row.id)).toArray();
  const queued = await db.outbox.filter((row) => row.domain === NOTES_DOMAIN).toArray();
  const legacyIds = new Set(rows.map((row) => row.id));
  for (const row of queued) {
    const noteId = parsePayload(row.payload)?.noteId;
    if (typeof noteId === "string" && isLegacyLocalNoteId(noteId)) legacyIds.add(noteId);
  }

  for (const localId of legacyIds) {
    const uid = uuidFromLegacyLocalId(localId);
    await db.transaction("rw", [notes, db.outbox], async () => {
      const cached = noteFromRow(await notes.get(localId));
      let hasCreate = false;
      for (const row of await db.outbox.filter((r) => r.domain === NOTES_DOMAIN).toArray()) {
        const payload = parsePayload(row.payload);
        if (!payload || (payload.noteId !== localId && payload.tempNoteId !== localId)) continue;
        delete payload.tempNoteId;
        payload.noteId = uid;
        if (row.op === "upsert") {
          payload.create = true;
          hasCreate = true;
        }
        await db.outbox.put({ ...row, payload: JSON.stringify(payload) });
      }
      if (!cached) return;
      const note: Note = { ...cached, id: uid, createPending: true };
      await notes.delete(localId);
      await notes.put(noteRow(note, true));
      if (!hasCreate) await enqueueCoalescedNoteUpdate(username, uid, note, undefined, true);
    });
    await migrateNoteCollabRoom(localId, uid);
  }

  const staleMeta = await db.meta
    .filter((row) => LEGACY_META_PREFIXES.some((prefix) => row.key.startsWith(prefix)))
    .primaryKeys();
  if (staleMeta.length > 0) await db.meta.bulkDelete(staleMeta);
}
