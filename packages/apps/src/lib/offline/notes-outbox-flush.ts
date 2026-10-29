import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import type { DeleteNotebookAction } from "@/notes-core/src/notes-types";
import {
  archiveNoteItem,
  createNoteItem,
  createNotebook,
  deleteNotebook,
  deleteNoteItem,
  renameNotebook,
  restoreNoteItem,
  updateNoteItem,
} from "@/lib/api/wgw/notes";
import { getNote, listNotebooks, noteFromVjournal } from "@/lib/api/wgw/notes-vjournal";
import type { WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  type SentOutboxSettlement,
  sendChangedRowAgain,
  settleSentOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { baseUpdatedAt } from "@/lib/offline/notes/notes-metadata-selection";
import { NOTES_DOMAIN, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { announceNoteCreated } from "@/lib/offline/notes/notes-created-events";
import {
  isNoteArchivedRefusal,
  settleNoteArchivedElsewhere,
} from "@/lib/offline/notes/notes-archived-elsewhere";
import { upgradeLegacyLocalNotes } from "@/lib/offline/notes/notes-legacy-local-ids";
import {
  dropLocalNoteAfterServerGone,
  getNoteFromCache,
  listOutboxMutations,
  markOutboxError,
  type NoteUpsertMetadata,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeOutboxMutation,
  type NotesUpsertPayload,
  upsertNoteInCache,
  upsertNotebookInCache,
} from "@/lib/offline/notes-offline-store";
import { isNotesPersistGone, persistHttpStatus } from "@/notes-core/src/notes-persist-access";

export type OutboxFlushResult = {
  stateMismatches: string[];
  bootstrap: NotesAppBootstrap | null;
};

function isPreconditionFailed(error: unknown): boolean {
  return persistHttpStatus(error) === 412;
}

async function flushOutboxNoteUpsert(
  username: string,
  noteId: string,
  metadata: NoteUpsertMetadata,
  metadataRequest: WgwNoteUpsertRequest,
  create?: boolean,
): Promise<{ saved: Note } | { conflict: true } | { gone: true }> {
  if (create) {
    // The UID is the client's, so a retry (or another tab) gets the same note back.
    const created = await createNoteItem({
      ...metadataRequest,
      notebook: metadata.notebook,
      body: "",
    });
    if (createAnswerHasMetadata(created, metadata)) return { saved: created };
    // A resent create is answered with the note as first stored, which may
    // predate a title, tags, star or move queued with it: send those as an
    // update. The notebook goes along only when the answer has another one.
    const { notebook: _notebook, notebookId: _notebookId, ...update } = metadataRequest;
    const move = sameNotebook(created, metadata)
      ? {}
      : {
          notebook: metadata.notebook,
          ...(metadata.notebookId ? { notebookId: metadata.notebookId } : {}),
        };
    return { saved: await updateNoteItem(noteId, { ...update, ...move, etag: created.etag }) };
  }
  try {
    return { saved: await updateNoteItem(noteId, metadataRequest) };
  } catch (error) {
    if (isPreconditionFailed(error)) {
      try {
        return { saved: await updateNoteItem(noteId, { ...metadataRequest, etag: undefined }) };
      } catch (retryError) {
        if (isPreconditionFailed(retryError)) return { conflict: true };
        if (!isNoteArchivedRefusal(retryError)) throw retryError;
        await settleNoteArchivedElsewhere(username, noteId);
        return { gone: true };
      }
    }
    // Archive wins over a queued edit (#1535): drop it and say so.
    if (isNoteArchivedRefusal(error)) {
      await settleNoteArchivedElsewhere(username, noteId);
      return { gone: true };
    }
    if (persistHttpStatus(error) !== 404) throw error;
    await dropLocalNoteAfterServerGone(username, noteId);
    return { gone: true };
  }
}

function sameTagSet(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(left);
  return set.size === new Set(right).size && right.every((tag) => set.has(tag));
}

function sameNotebook(created: Note, metadata: NoteUpsertMetadata): boolean {
  if (metadata.notebookId && created.notebookId) return created.notebookId === metadata.notebookId;
  return created.notebook === metadata.notebook;
}

/** True when the server's answer to a create holds the metadata it was sent. */
function createAnswerHasMetadata(created: Note, metadata: NoteUpsertMetadata): boolean {
  if (metadata.title !== undefined && (created.title ?? "") !== metadata.title) return false;
  if (metadata.tags !== undefined && !sameTagSet(created.tags ?? [], metadata.tags)) return false;
  if (metadata.starred !== undefined && Boolean(created.starred) !== metadata.starred) return false;
  return sameNotebook(created, metadata);
}

/** The queued row still owed after `saved` answered the send of an older version. */
function rebaseNoteUpsertRow(row: OfflineOutboxRow, saved: Note): OfflineOutboxRow {
  // The note is on the server now: what is left is an update from its answer.
  const { create: _create, ...payload } = JSON.parse(row.payload) as NotesUpsertPayload;
  // A move merged into the row while the create was on its way is no longer
  // sent with a create: the update has to carry the notebook itself.
  const moved = !sameNotebook(saved, payload.metadata);
  return {
    ...row,
    payload: JSON.stringify(moved ? { ...payload, patchNotebook: true } : payload),
    ifInState: baseUpdatedAt(saved),
  };
}

/**
 * Settle a sent upsert. An edit queued while the request was on its way stays
 * in the outbox, and the cache keeps that newer copy, now marked as created
 * so later edits are not queued as a create again (#1711).
 */
function settleSentNoteUpsert(
  username: string,
  row: OfflineOutboxRow,
  saved: Note,
): Promise<SentOutboxSettlement> {
  return settleSentOutboxMutation(username, row, {
    rebase: (current) => rebaseNoteUpsertRow(current, saved),
    cacheTables: (db) => [notesNotesTable(db)],
    onRemoved: () => upsertNoteInCache(username, saved, false),
    onChanged: async () => {
      const local = await getNoteFromCache(username, saved.id);
      if (!local) return;
      const { createPending: _created, ...rest } = local;
      await upsertNoteInCache(username, { ...rest, etag: saved.etag }, true);
    },
  });
}

/** Metadata-only REST upsert — no `body`; starred is routed to `/notes/items/{id}/star`. */
function noteMetadataUpsertRequest(
  noteId: string,
  metadata: NoteUpsertMetadata,
  etag: string | undefined,
  patchNotebook: boolean | undefined,
  create: boolean | undefined,
): WgwNoteUpsertRequest {
  // Only a create or a move sends the notebook (see metadataSelection).
  const sendNotebook = create === true || patchNotebook === true;
  return {
    id: noteId,
    ...(sendNotebook ? { notebook: metadata.notebook } : {}),
    ...(sendNotebook && metadata.notebookId ? { notebookId: metadata.notebookId } : {}),
    ...(metadata.title !== undefined ? { title: metadata.title } : {}),
    ...(metadata.tags !== undefined ? { tags: metadata.tags } : {}),
    ...(metadata.tagsAdd !== undefined ? { tagsAdd: metadata.tagsAdd } : {}),
    ...(metadata.tagsRemove !== undefined ? { tagsRemove: metadata.tagsRemove } : {}),
    ...(metadata.starred !== undefined ? { starred: metadata.starred } : {}),
    ...(metadata.archived !== undefined ? { archived: metadata.archived } : {}),
    ...(metadata.groupSlug?.trim() ? { groupSlug: metadata.groupSlug.trim() } : {}),
    ...(etag ? { etag } : {}),
  };
}

const legacyUpgraded = new Set<string>();

/**
 * Notes queued by an older app version still carry a temporary id. Rewriting
 * them is one-off work, so it runs once per page load per account; a failure
 * is logged and tried again on the next load instead of stopping the flush.
 */
async function upgradeLegacyLocalNotesOnce(username: string): Promise<void> {
  if (legacyUpgraded.has(username)) return;
  try {
    await upgradeLegacyLocalNotes(username);
    legacyUpgraded.add(username);
  } catch (error) {
    console.warn("[notes] legacy local id upgrade failed", error);
  }
}

export async function flushNotesOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) {
    return { stateMismatches: [], bootstrap: null };
  }

  await upgradeLegacyLocalNotesOnce(username);
  const rows = await listOutboxMutations(username);
  const stateMismatches: string[] = [];
  // Notes whose rows this flush already dropped (deleted or archived elsewhere).
  const settled = new Set<string>();
  // Rows sent again in this flush (`sendChangedRowAgain` appends to `rows`).
  const resends = new Map<string, number>();

  for (const row of rows) {
    if (row.domain !== NOTES_DOMAIN) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "upsert") {
        const upsert = payload as NotesUpsertPayload;
        const noteId = upsert.noteId;
        if (settled.has(noteId)) continue;
        const metadataRequest = noteMetadataUpsertRequest(
          noteId,
          upsert.metadata,
          row.ifInState,
          upsert.patchNotebook,
          upsert.create,
        );
        const result = await flushOutboxNoteUpsert(
          username,
          noteId,
          upsert.metadata,
          metadataRequest,
          upsert.create,
        );
        if ("conflict" in result) {
          stateMismatches.push(noteId);
          await markOutboxError(username, row.id, "stateMismatch");
          continue;
        }
        if ("gone" in result) {
          settled.add(noteId);
          await removeOutboxMutation(username, row.id);
          continue;
        }
        const settlement = await settleSentNoteUpsert(username, row, result.saved);
        if (upsert.create) announceNoteCreated({ username, noteId: result.saved.id });
        sendChangedRowAgain(rows, resends, settlement);
        continue;
      } else if (row.op === "delete") {
        const noteId = String(payload.noteId ?? "");
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        try {
          await deleteNoteItem(noteId, {
            notebook: String(payload.notebook ?? ""),
            archived: Boolean(payload.archived),
            ...(groupSlug ? { groupSlug } : {}),
            ...(typeof payload.etag === "string" && payload.etag ? { etag: payload.etag } : {}),
          });
        } catch (error) {
          if (isPreconditionFailed(error)) {
            stateMismatches.push(noteId);
            await markOutboxError(username, row.id, "stateMismatch");
            continue;
          }
          if (isNotesPersistGone(error)) {
            await dropLocalNoteAfterServerGone(username, noteId);
            await removeOutboxMutation(username, row.id);
            continue;
          }
          throw error;
        }
        await removeNoteFromCache(username, noteId);
      } else if (row.op === "archive" || row.op === "restore") {
        const noteId = String(payload.noteId ?? "");
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        try {
          const saved =
            row.op === "archive"
              ? await archiveNoteItem(noteId, groupSlug ? { groupSlug } : undefined)
              : await restoreNoteItem(noteId, groupSlug ? { groupSlug } : undefined);
          await upsertNoteInCache(username, saved, false);
        } catch (error) {
          if (isNotesPersistGone(error)) {
            await dropLocalNoteAfterServerGone(username, noteId);
            await removeOutboxMutation(username, row.id);
            continue;
          }
          throw error;
        }
      } else if (row.op === "createNotebook") {
        const color =
          typeof payload.color === "string" && payload.color.trim()
            ? payload.color.trim()
            : undefined;
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        const created = await createNotebook(String(payload.name ?? ""), {
          ...(color ? { color } : {}),
          ...(groupSlug ? { groupSlug } : {}),
        });
        await upsertNotebookInCache(username, created);
      } else if (row.op === "renameNotebook") {
        await renameNotebook(String(payload.from ?? ""), String(payload.to ?? ""));
      } else if (row.op === "deleteNotebook") {
        const action = payload.action as DeleteNotebookAction;
        await deleteNotebook(String(payload.name ?? ""), action);
      }
      await removeOutboxMutation(username, row.id);
    } catch (error) {
      const status = httpStatusFromFlushError(error);
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
        status,
      );
    }
  }

  // Each row already updated the cache. Writing a read-back snapshot over the
  // table would drop a note another writer saved meanwhile.
  const nextBootstrap = await readNotesBootstrapFromCache(username);
  if (nextBootstrap) nextBootstrap.session = cached.session;

  return { stateMismatches, bootstrap: nextBootstrap };
}

/** Fetch a single note from VJOURNAL REST (used by conflict resolution). */
export async function fetchServerNote(noteId: string) {
  const [row, notebooks] = await Promise.all([getNote(noteId), listNotebooks()]);
  return noteFromVjournal(row, notebooks);
}
