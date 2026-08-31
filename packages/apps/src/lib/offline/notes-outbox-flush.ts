import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
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
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { migrateNoteCollabPersistenceAfterIdRemap } from "@/lib/offline/notes/notes-collab-persistence-migrate";
import {
  dropLocalNoteAfterServerGone,
  listOutboxMutations,
  markOutboxError,
  type NoteUpsertMetadata,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeOutboxMutation,
  type NotesUpsertPayload,
  upsertNoteInCache,
  upsertNotebookInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { isNotesPersistGone } from "@/notes-core/src/notes-persist-access";

export type OutboxFlushResult = {
  stateMismatches: string[];
  bootstrap: NotesAppBootstrap | null;
};

function isPreconditionFailed(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 412;
}

/** Metadata-only REST upsert — no `body`; starred is routed to `/notes/items/{id}/star`. */
function noteMetadataUpsertRequest(
  noteId: string,
  metadata: NoteUpsertMetadata,
  etag?: string,
): WgwNoteUpsertRequest {
  return {
    id: noteId,
    notebook: metadata.notebook,
    ...(metadata.title !== undefined ? { title: metadata.title } : {}),
    tags: metadata.tags,
    ...(metadata.starred !== undefined ? { starred: metadata.starred } : {}),
    ...(metadata.archived !== undefined ? { archived: metadata.archived } : {}),
    ...(metadata.groupSlug?.trim() ? { groupSlug: metadata.groupSlug.trim() } : {}),
    ...(etag ? { etag } : {}),
  };
}

function notebookDeleteBodyForAction(action: DeleteNotebookAction): {
  mode: "archive" | "move" | "purge";
  target?: string;
} {
  if (action.kind === "archive") return { mode: "archive" };
  if (action.kind === "purge") return { mode: "purge" };
  return { mode: "move", target: action.target };
}

export async function flushNotesOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) {
    return { stateMismatches: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const stateMismatches: string[] = [];

  for (const row of rows) {
    if (row.domain !== NOTES_DOMAIN) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "upsert") {
        const upsert = payload as NotesUpsertPayload;
        const noteId = upsert.noteId;
        const metadataRequest = noteMetadataUpsertRequest(noteId, upsert.metadata, row.ifInState);
        let saved;
        try {
          saved = await updateNoteItem(noteId, metadataRequest);
        } catch (error) {
          if (isPreconditionFailed(error)) {
            try {
              // Stale If-Match after our own create/title/body PATCH — refetch etag.
              saved = await updateNoteItem(noteId, {
                ...metadataRequest,
                etag: undefined,
              });
            } catch (retryError) {
              if (isPreconditionFailed(retryError) && upsert.tempNoteId) {
                // Still our create race: last-writer-wins, do not open Keep mine.
                saved = await updateNoteItem(noteId, {
                  ...metadataRequest,
                  etag: undefined,
                });
              } else if (isPreconditionFailed(retryError)) {
                stateMismatches.push(noteId);
                await markOutboxError(username, row.id, "stateMismatch");
                continue;
              } else {
                throw retryError;
              }
            }
          } else {
            const status = (error as { status?: number } | undefined)?.status;
            if (status !== 404) throw error;
            // local-* first persist: create. A real UID 404 is gone — drop, don't resurrect.
            if (!upsert.tempNoteId) {
              await dropLocalNoteAfterServerGone(username, noteId);
              await removeOutboxMutation(username, row.id);
              continue;
            }
            saved = await createNoteItem({ ...metadataRequest, body: "" });
          }
        }
        const tempId = upsert.tempNoteId;
        if (tempId && tempId !== saved.id) {
          await migrateNoteCollabPersistenceAfterIdRemap({
            username,
            notebook: upsert.metadata.notebook,
            tempNoteId: tempId,
            savedNoteId: saved.id,
            archived: upsert.metadata.archived,
          });
          await removeNoteFromCache(username, tempId);
        }
        await upsertNoteInCache(username, saved, false);
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
        await deleteNotebook(String(payload.name ?? ""), notebookDeleteBodyForAction(action));
      }
      await removeOutboxMutation(username, row.id);
    } catch (error) {
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const nextBootstrap = await readNotesBootstrapFromCache(username);
  if (nextBootstrap) {
    nextBootstrap.session = cached.session;
    await writeNotesBootstrapToCache(username, nextBootstrap);
  }

  return { stateMismatches, bootstrap: nextBootstrap };
}

/** Fetch a single note from VJOURNAL REST (used by conflict resolution). */
export async function fetchServerNote(noteId: string) {
  const [row, notebooks] = await Promise.all([getNote(noteId), listNotebooks()]);
  return noteFromVjournal(row, notebooks);
}
