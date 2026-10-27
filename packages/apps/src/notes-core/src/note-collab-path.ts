import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import { isNotesPersistForbidden } from "@/notes-core/src/notes-persist-access";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";

/** Room key = VJOURNAL UID = REST noteId. */
export function encodeNoteRoomId(uid: string): string {
  return encodeFileRoomId(uid);
}

/**
 * Notes uses the same collab save as Docs. Title, tags, notebook, and archive
 * stay on the Notes metadata outbox. The body is the shared document.
 */
export async function buildNoteCollabUrls(
  noteId: string,
  hooks?: {
    /** Not on the server yet: keep the body in a local-only room until it is. */
    createPending?: boolean;
    onPersistForbidden?: () => void;
    /** The shared save accepted this markdown. */
    onPersistSuccess?: (markdown: string) => void;
  },
): Promise<DocsCollabUrls> {
  const baseUrl = wgwApiBaseUrl();
  const roomId = encodeNoteRoomId(noteId);
  const authToken = (await wgwEnsureFreshAccessToken()) ?? undefined;
  const itemUrl = `${baseUrl}/notes/items/${encodeURIComponent(noteId)}`;

  return {
    signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
    collabApiBaseUrl: `${baseUrl}/rooms`,
    collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
    authToken,
    documentUrl: itemUrl,
    yjsUrl: `${itemUrl}?format=yjs`,
    room: noteId,
    roomNotPersistent: hooks?.createPending === true,
    onPersistForbidden: hooks?.onPersistForbidden,
    onPersistSuccess: hooks?.onPersistSuccess,
  };
}

export function isNotesCollabForbiddenError(error: unknown): boolean {
  return isNotesPersistForbidden(error);
}
