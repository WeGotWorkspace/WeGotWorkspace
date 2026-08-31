import { getNote, persistNoteMarkdown } from "@/lib/api/wgw/notes-vjournal";
import { writeNoteCollabOfflineContent } from "@/lib/offline/notes/notes-collab-rooms";
import { getDocsCollabSyncState } from "@/text-editor-core/docs-collab/docs-collab-sync-registry";

export type NotesLocalDirtyInput = {
  noteId: string | null | undefined;
  pendingNoteIds: ReadonlySet<string>;
  editorDirty: boolean;
};

/** Open-editor dirty, pending Yjs save, or Dexie pending — Decision 6. */
export function isNotesLocalDirty(input: NotesLocalDirtyInput): boolean {
  const noteId = input.noteId;
  if (!noteId) return false;
  if (input.editorDirty) return true;
  if (input.pendingNoteIds.has(noteId)) return true;
  return getDocsCollabSyncState(noteId).pendingServerSave;
}

/**
 * Keep mine: PATCH the local body with the *new* server etag (Decision 6 overwrite).
 */
export async function keepMineNotesReconnect(input: {
  noteId: string;
  markdown: string;
}): Promise<void> {
  const fresh = await getNote(input.noteId);
  await persistNoteMarkdown(input.noteId, input.markdown, fresh.etag);
}

/**
 * Use theirs: write server DESCRIPTION into the UID Y.Doc, then remount/refresh.
 */
export async function applyTheirsNotesReconnect(input: {
  noteId: string;
  applyServerBody: (markdown: string) => void;
  refreshList?: () => void;
}): Promise<string> {
  const fresh = await getNote(input.noteId);
  const body = fresh.body ?? "";
  await writeNoteCollabOfflineContent(input.noteId, body);
  input.applyServerBody(body);
  input.refreshList?.();
  return body;
}
