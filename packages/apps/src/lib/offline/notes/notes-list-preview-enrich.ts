import type { Note } from "@/lib/models/note";
import { readCollabOfflineContent } from "@/lib/offline/docs/docs-collab-offline-content";
import { resolveNoteSharePath } from "@/notes-core/src/note-collab-path";
import {
  applyNoteBodyMarkdown,
  enrichNote,
  noteHasListableBody,
} from "@/notes-core/src/notes-note-utils";

const ENRICH_CONCURRENCY = 4;

/**
 * Fill empty list previews from collab y-indexeddb snapshots after a hard reload.
 *
 * Body edits persist through the Docs collab document; a debounced save may not
 * have reached the Notes `.md` file yet, so GET /notes/items (and Dexie after
 * bootstrap) can still look empty while IndexedDB already has the typed text.
 * Opening a note hydrates the editor — this path does the same for **all** empty
 * rows without mounting TipTap in the list.
 */
export async function enrichNotesListPreviewsFromCollabOffline(
  username: string,
  notes: readonly Note[],
): Promise<Note[]> {
  if (!username || notes.length === 0) return [...notes];

  const result = notes.map((note) => note);
  const pendingIndexes: number[] = [];
  for (let i = 0; i < result.length; i++) {
    const note = result[i]!;
    if (noteHasListableBody(note)) continue;
    pendingIndexes.push(i);
  }
  if (pendingIndexes.length === 0) return result;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pendingIndexes.length) {
      const index = pendingIndexes[cursor]!;
      cursor += 1;
      const note = result[index]!;
      const path = resolveNoteSharePath(note, username, !!note.archived);
      const markdown = await readCollabOfflineContent(path);
      if (markdown == null || !markdown.trim()) continue;
      result[index] = enrichNote(applyNoteBodyMarkdown(note, markdown, { bumpDate: false }));
    }
  }

  const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, pendingIndexes.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return result;
}
