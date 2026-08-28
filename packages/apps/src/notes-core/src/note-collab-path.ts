import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { getNote, persistNoteMarkdown } from "@/lib/api/wgw/notes-vjournal";
import type { Note } from "@/lib/models/note";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import {
  isNotesPersistForbidden,
  resolveNotesPersistAccess,
} from "@/notes-core/src/notes-persist-access";
import { resolveNotesReconnect } from "@/notes-core/src/notes-reconnect";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";

/**
 * Legacy Drive-path helpers kept for FileNode teardown / offline migration.
 * Live collab uses {@link buildNoteCollabUrls} keyed by VJOURNAL UID.
 */
export type NoteCollabScope =
  | { kind: "personal"; username: string }
  | { kind: "group"; slug: string };

export type NoteCollabPathArgs = {
  scope: NoteCollabScope;
  notebook: string;
  noteId: string;
  archived?: boolean;
};

function scopeRoot(scope: NoteCollabScope): string {
  return scope.kind === "group" ? `groups/${scope.slug}/.notes` : `users/${scope.username}/.notes`;
}

export function noteCollabScopeFromNote(
  note: Pick<Note, "scope" | "groupSlug">,
  username: string,
): NoteCollabScope {
  if (note.scope === "group" && note.groupSlug?.trim()) {
    return { kind: "group", slug: note.groupSlug.trim() };
  }
  return { kind: "personal", username };
}

export function notebookCollabPath(scope: NoteCollabScope, notebook: string): string {
  return `${scopeRoot(scope)}/${notebook}`;
}

export function noteCollabPath({ scope, notebook, noteId, archived }: NoteCollabPathArgs): string {
  const root = scopeRoot(scope);
  const notebookDir = archived ? `${root}/.archive/${notebook}` : `${root}/${notebook}`;
  return `${notebookDir}/${noteId}.md`;
}

export function resolveNoteSharePath(
  note: Pick<Note, "id" | "notebook" | "scope" | "groupSlug" | "apiPath">,
  username: string,
  archived = false,
): string {
  const known = note.apiPath?.trim();
  if (known) return known.startsWith("/") ? known : `/${known}`;
  const path = noteCollabPath({
    scope: noteCollabScopeFromNote(note, username),
    notebook: note.notebook,
    noteId: note.id,
    archived,
  });
  return path.startsWith("/") ? path : `/${path}`;
}

/** Room key = VJOURNAL UID = REST noteId. */
export function encodeNoteRoomId(uid: string): string {
  return encodeFileRoomId(uid);
}

export async function buildNoteCollabUrls(
  noteId: string,
  initialEtag: string,
  hooks?: {
    onPersistForbidden?: () => void;
    onReconnectConflict?: () => void;
    getLocalDirty?: () => boolean;
    onEtag?: (etag: string) => void;
  },
): Promise<DocsCollabUrls> {
  const baseUrl = wgwApiBaseUrl();
  const roomId = encodeNoteRoomId(noteId);
  const authToken = (await wgwEnsureFreshAccessToken()) ?? undefined;
  let etag = initialEtag;

  const persistMarkdown = async (markdown: string) => {
    try {
      const updated = await persistNoteMarkdown(noteId, markdown, etag);
      etag = updated.etag;
      hooks?.onEtag?.(etag);
    } catch (error) {
      if (resolveNotesPersistAccess(error) === "leave-room") {
        hooks?.onPersistForbidden?.();
      }
      throw error;
    }
  };

  const loadDocumentMarkdown = async () => {
    const note = await getNote(noteId);
    const dirty = hooks?.getLocalDirty?.() ?? false;
    const decision = resolveNotesReconnect({
      localDirty: dirty,
      etagChanged: etag !== "" && note.etag !== etag,
    });
    if (decision === "conflict") {
      hooks?.onReconnectConflict?.();
      throw new Error("precondition failed (412)");
    }
    etag = note.etag;
    hooks?.onEtag?.(etag);
    return note.body ?? "";
  };

  return {
    signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${baseUrl}/rooms`,
    collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
    authToken,
    documentUrl: `${baseUrl}/notes/items/${encodeURIComponent(noteId)}`,
    yjsUrl: `${baseUrl}/notes/items/${encodeURIComponent(noteId)}`,
    documentSaveMethod: "PATCH",
    room: noteId,
    skipYjsSnapshot: true,
    persistMarkdown,
    loadDocumentMarkdown,
    onPersistForbidden: hooks?.onPersistForbidden,
    onReconnectConflict: hooks?.onReconnectConflict,
  };
}

export function isNotesCollabForbiddenError(error: unknown): boolean {
  return isNotesPersistForbidden(error);
}
