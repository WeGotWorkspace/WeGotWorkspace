import type { Note } from "@/lib/models/note";
import type { NoteMetadataField } from "@/notes-core/src/notes-types";

export function baseUpdatedAt(note: Note): string | undefined {
  if (note.etag) return note.etag;
  if (note.updatedAt) return note.updatedAt;
  return note.date !== "—" ? note.date : undefined;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

/**
 * Which snapshot fields this write is allowed to put on the PATCH. Named
 * `fields` win over a diff against `previous`, which may be newer than the
 * edit (a tag added while a title save was debounced).
 *
 * The notebook is sent only when the save names it: a move. A diff cannot
 * tell a move from an older save that missed one, and sending that older
 * notebook moved the note back.
 */
export function metadataSelection(
  previous: Note | undefined,
  note: Note,
  hasDelta: boolean,
  fields?: readonly NoteMetadataField[],
): {
  includeTitle: boolean;
  includeTags: boolean;
  includeStarred: boolean;
  includeNotebook: boolean;
} {
  // A note not on the server yet sends its whole snapshot with the create.
  if (fields && !note.createPending) {
    return {
      includeTitle: fields.includes("title"),
      includeTags: !hasDelta && fields.includes("tags"),
      includeStarred: fields.includes("starred"),
      includeNotebook: fields.includes("notebook"),
    };
  }
  if (note.createPending) {
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
    includeNotebook: false,
  };
}

/** Only the named fields of `note`, to lay over the cached copy. */
export function noteFieldsPatch(note: Note, fields: readonly NoteMetadataField[]): Partial<Note> {
  return {
    ...(fields.includes("title") ? { title: note.title } : {}),
    ...(fields.includes("tags") ? { tags: note.tags } : {}),
    ...(fields.includes("starred") ? { starred: note.starred } : {}),
    ...(fields.includes("notebook")
      ? {
          notebook: note.notebook,
          notebookId: note.notebookId,
          scope: note.scope,
          groupSlug: note.groupSlug,
        }
      : {}),
  };
}
