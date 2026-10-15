import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";
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
    onPersistForbidden?: () => void;
    onReconnectConflict?: () => void;
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
    roomNotPersistent: isLocalTempNoteId(noteId),
    onPersistForbidden: hooks?.onPersistForbidden,
    onReconnectConflict: hooks?.onReconnectConflict,
    onPersistSuccess: hooks?.onPersistSuccess,
  };
}

export function isNotesCollabForbiddenError(error: unknown): boolean {
  return isNotesPersistForbidden(error);
}
