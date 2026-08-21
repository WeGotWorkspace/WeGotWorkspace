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
import {
  findNoteFileNode,
  listOwnedNotesFromFileNodes,
  noteFromFileNodeNote,
} from "@/lib/api/wgw/notes-filenode";
import type { WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
import { applyDocsStarToggle } from "@/lib/offline/docs/docs-stars-store";
import { resolveNoteSharePath } from "@/notes-core/src/note-collab-path";
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

/** Metadata-only FileNode upsert — no `body`; starred is routed to Drive stars. */
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
  try {
    const listing = await listOwnedNotesFromFileNodes();
    return new Map(listing.notes.map((item) => [item.id, { updatedAt: item.updatedAt }]));
  } catch {
    return new Map();
  }
}

async function persistFlushedStar(
  username: string,
  noteId: string,
  metadata: NoteUpsertMetadata,
  apiPath?: string,
): Promise<void> {
  if (metadata.starred === undefined) return;
  const path = resolveNoteSharePath(
    {
      id: noteId,
      notebook: metadata.notebook,
      scope: metadata.groupSlug?.trim() ? "group" : "personal",
      groupSlug: metadata.groupSlug,
      apiPath,
    },
    username,
    !!metadata.archived,
  );
  await applyDocsStarToggle(username, path, metadata.starred);
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
            // Metadata-only conflict. Compare FileNode `changed` (index
            // updated_at). Body-only collab saves should not bump it; if they
            // do, this guard may false-conflict (residual until G).
            stateMismatches.push(noteId);
            await markOutboxError(username, row.id, "stateMismatch");
            continue;
          }
        }
        // FileNode/set preserves body bytes; 404 create seeds empty markdown.
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
        await persistFlushedStar(username, saved.id, upsert.metadata, saved.apiPath);
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

/** Fetch a single note from FileNode get (used by conflict resolution). */
export async function fetchServerNote(noteId: string) {
  const found = await findNoteFileNode(noteId);
  if (!found) throw new Error(`Note ${noteId} not found on server`);
  return noteFromFileNodeNote({
    id: found.noteId,
    projection: found.projection,
    path: found.path,
    scope: found.root.scope,
    groupSlug: found.root.groupSlug,
    modified: typeof found.node.modified === "string" ? found.node.modified : undefined,
    changed: typeof found.node.changed === "string" ? found.node.changed : undefined,
  });
}
