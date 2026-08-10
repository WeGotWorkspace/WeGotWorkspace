import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { DeleteNotebookAction } from "@/notes-core/src/notes-types";
import {
  archiveNoteItem,
  createNoteItem,
  createNotebook,
  deleteNotebook,
  deleteNoteItem,
  noteFromWgwItem,
  parseNotesItemsPayload,
  renameNotebook,
  restoreNoteItem,
  updateNoteItem,
} from "@/lib/api/wgw/notes";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import type { WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { migrateNoteCollabPersistenceAfterIdRemap } from "@/lib/offline/notes/notes-collab-persistence-migrate";
import {
  listOutboxMutations,
  markOutboxError,
  type NoteUpsertMetadata,
  noteUpdatedAtMs,
  readNotesBootstrapFromCache,
  removeNoteFromCache,
  removeOutboxMutation,
  type NotesUpsertPayload,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";

export type OutboxFlushResult = {
  stateMismatches: string[];
  bootstrap: NotesAppBootstrap | null;
};

/** Build a metadata-only `PUT /notes/items/{id}` request — no `body` field. */
function noteMetadataUpsertRequest(
  noteId: string,
  metadata: NoteUpsertMetadata,
): WgwNoteUpsertRequest {
  return {
    id: noteId,
    notebook: metadata.notebook,
    tags: metadata.tags,
    ...(metadata.starred !== undefined ? { starred: metadata.starred } : {}),
    ...(metadata.archived !== undefined ? { archived: metadata.archived } : {}),
    ...(metadata.groupSlug?.trim() ? { groupSlug: metadata.groupSlug.trim() } : {}),
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

async function fetchServerNotesById(): Promise<Map<string, { updatedAt?: string }>> {
  const res = await wgwFetch("/notes/items");
  if (!res.ok) return new Map();
  const json = await wgwReadJson(res);
  const items = parseNotesItemsPayload(json);
  return new Map(items.map((item) => [item.id, { updatedAt: item.updatedAt }]));
}

function serverUpdatedAtMs(
  serverNotes: Map<string, { updatedAt?: string }>,
  noteId: string,
): number {
  return noteUpdatedAtMs(serverNotes.get(noteId)?.updatedAt);
}

export async function flushNotesOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readNotesBootstrapFromCache(username);
  if (!cached) {
    return { stateMismatches: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const stateMismatches: string[] = [];
  const serverNotes = await fetchServerNotesById();

  for (const row of rows) {
    if (row.domain !== NOTES_DOMAIN) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "upsert") {
        const upsert = payload as NotesUpsertPayload;
        const noteId = upsert.noteId;
        if (row.ifInState) {
          const serverMs = serverUpdatedAtMs(serverNotes, noteId);
          const baseMs = noteUpdatedAtMs(row.ifInState);
          if (serverMs > baseMs) {
            // Metadata-only conflict. The API derives a note's `updatedAt` from a
            // frontmatter marker that only metadata mutations bump — body-only
            // collab saves (`PUT /files/collaboration`) preserve it — so a
            // server-newer reading here always reflects a genuine frontmatter
            // divergence, never a concurrent body edit.
            stateMismatches.push(noteId);
            await markOutboxError(username, row.id, "stateMismatch");
            continue;
          }
        }
        // Metadata-only PUT preserves the body bytes on disk; the 404 create
        // fallback seeds an empty body (collab persists the real body separately).
        const metadataRequest = noteMetadataUpsertRequest(noteId, upsert.metadata);
        let saved;
        try {
          saved = await updateNoteItem(noteId, metadataRequest);
        } catch (error) {
          const status = (error as { status?: number } | undefined)?.status;
          if (status !== 404) throw error;
          saved = await createNoteItem({ ...metadataRequest, body: "" });
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
        serverNotes.set(saved.id, { updatedAt: saved.updatedAt ?? saved.date });
      } else if (row.op === "delete") {
        const noteId = String(payload.noteId ?? "");
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        await deleteNoteItem(noteId, {
          notebook: String(payload.notebook ?? ""),
          archived: Boolean(payload.archived),
          ...(groupSlug ? { groupSlug } : {}),
        });
        await removeNoteFromCache(username, noteId);
      } else if (row.op === "archive") {
        const noteId = String(payload.noteId ?? "");
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        const saved = await archiveNoteItem(noteId, groupSlug ? { groupSlug } : undefined);
        await upsertNoteInCache(username, saved, false);
        serverNotes.set(saved.id, { updatedAt: saved.updatedAt ?? saved.date });
      } else if (row.op === "restore") {
        const noteId = String(payload.noteId ?? "");
        const groupSlug =
          typeof payload.groupSlug === "string" && payload.groupSlug.trim()
            ? payload.groupSlug.trim()
            : undefined;
        const saved = await restoreNoteItem(noteId, groupSlug ? { groupSlug } : undefined);
        await upsertNoteInCache(username, saved, false);
        serverNotes.set(saved.id, { updatedAt: saved.updatedAt ?? saved.date });
      } else if (row.op === "createNotebook") {
        await createNotebook(String(payload.name ?? ""));
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

/** Fetch a single note from the live items list (used by conflict resolution). */
export async function fetchServerNote(noteId: string) {
  const res = await wgwFetch("/notes/items");
  if (!res.ok) throw new Error(`GET /notes/items failed (${res.status})`);
  const json = await wgwReadJson(res);
  const items = parseNotesItemsPayload(json);
  const row = items.find((item) => item.id === noteId);
  if (!row) throw new Error(`Note ${noteId} not found on server`);
  return noteFromWgwItem(row);
}
