import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import type { Note } from "@/lib/models/note";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";

/**
 * Where a note body lives on the shared `wgw_files` tree.
 *
 * - `personal` → `users/{username}/.notes/{notebook}/{id}.md`
 * - `group`    → `groups/{slug}/.notes/{notebook}/{id}.md`
 *
 * Body collab reuses the Docs stack keyed by this virtual path. Title/tags
 * and notebook/archive moves go through FileNode/set; starring is Drive
 * `POST|DELETE /files/star`.
 */
export type NoteCollabScope =
  | { kind: "personal"; username: string }
  | { kind: "group"; slug: string };

export type NoteCollabPathArgs = {
  scope: NoteCollabScope;
  notebook: string;
  noteId: string;
  /** Archived notes live under a `.archive` subtree (mirrors the API NoteStoragePaths). */
  archived?: boolean;
};

function scopeRoot(scope: NoteCollabScope): string {
  return scope.kind === "group" ? `groups/${scope.slug}/.notes` : `users/${scope.username}/.notes`;
}

/** Resolve collab scope from note metadata; falls back to the signed-in personal home. */
export function noteCollabScopeFromNote(
  note: Pick<Note, "scope" | "groupSlug">,
  username: string,
): NoteCollabScope {
  if (note.scope === "group" && note.groupSlug?.trim()) {
    return { kind: "group", slug: note.groupSlug.trim() };
  }
  return { kind: "personal", username };
}

/** Notebook directory virtual path (`…/.notes/{notebook}`). */
export function notebookCollabPath(scope: NoteCollabScope, notebook: string): string {
  return `${scopeRoot(scope)}/${notebook}`;
}

/** Map a note (scope + notebook + id) to its collab virtual path. */
export function noteCollabPath({ scope, notebook, noteId, archived }: NoteCollabPathArgs): string {
  const root = scopeRoot(scope);
  const notebookDir = archived ? `${root}/.archive/${notebook}` : `${root}/${notebook}`;
  return `${notebookDir}/${noteId}.md`;
}

/** Share/collab path for a note — prefers `apiPath` when the listing already provided it. */
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

/** Build the Docs-collab transport/document endpoints for a note virtual path. */
export async function buildNoteCollabUrls(path: string): Promise<DocsCollabUrls> {
  const baseUrl = wgwApiBaseUrl();
  const roomId = encodeFileRoomId(path);
  const pathQuery = encodeURIComponent(path);
  const authToken = (await wgwEnsureFreshAccessToken()) ?? undefined;
  return {
    signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${baseUrl}/rooms`,
    collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
    authToken,
    documentUrl: `${baseUrl}/files/collaboration?path=${pathQuery}`,
    yjsUrl: `${baseUrl}/files/collaboration?path=${pathQuery}&format=yjs`,
    documentSaveMethod: "PUT",
    room: path,
  };
}
