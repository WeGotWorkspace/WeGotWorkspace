import type { Note } from "@/lib/models/note";
import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";

export function baseUpdatedAt(note: Note): string | undefined {
  if (note.etag) return note.etag;
  if (note.updatedAt) return note.updatedAt;
  return note.date !== "—" ? note.date : undefined;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function notebookMoved(previous: Note, note: Note): boolean {
  const prevId = previous.notebookId?.trim() ?? "";
  const nextId = note.notebookId?.trim() ?? "";
  if (prevId !== "" && nextId !== "" && prevId !== nextId) return true;
  const prevName = previous.notebook.trim();
  const nextName = note.notebook.trim();
  return prevName !== "" && nextName !== "" && prevName !== nextName;
}

/** Which snapshot fields this write is allowed to put on the PATCH. */
export function metadataSelection(
  previous: Note | undefined,
  note: Note,
  hasDelta: boolean,
): {
  includeTitle: boolean;
  includeTags: boolean;
  includeStarred: boolean;
  includeNotebook: boolean;
} {
  if (isLocalTempNoteId(note.id)) {
    return {
      includeTitle: note.title !== undefined,
      includeTags: !hasDelta,
      includeStarred: note.starred !== undefined,
      includeNotebook: false,
    };
  }
  if (!previous) {
    return {
      includeTitle: false,
      includeTags: false,
      includeStarred: false,
      includeNotebook: false,
    };
  }
  return {
    includeTitle: note.title !== previous.title,
    includeTags: !hasDelta && !sameTags(previous.tags, note.tags),
    includeStarred: (note.starred ?? false) !== (previous.starred ?? false),
    includeNotebook: notebookMoved(previous, note),
  };
}
