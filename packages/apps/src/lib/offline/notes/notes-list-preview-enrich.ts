import type { Note } from "@/lib/models/note";
import { readNoteCollabOfflineContent } from "@/lib/offline/notes/notes-collab-rooms";
import {
  applyNoteBodyMarkdown,
  enrichNote,
  noteHasListableBody,
} from "@/notes-core/src/notes-note-utils";

const ENRICH_CONCURRENCY = 4;

/**
 * Fill empty list previews from the UID-keyed y-indexeddb crash buffer.
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
      const markdown = await readNoteCollabOfflineContent(note.id);
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
