import type { Note } from "@/lib/models/note";
import { isValidNewTag, normalizeTag } from "@/notes-core/src/note-tag";
import { noteAllowsTagAssignment } from "@/notes-core/src/notes-note-utils";

export type NoteTagRenamePlan = {
  from: string;
  to: string;
  /** Notes to rewrite, already filtered to writable rows. */
  notes: Note[];
  /** Ids that already carried `to`, so the rename merges rather than renames. */
  mergedIds: string[];
  /** Notes carrying `from` that may not be written. */
  skippedCount: number;
};

export type NoteTagRenameError = "invalid-name" | "unchanged" | "nothing-to-rename";

/** Resolve a rename into an explicit, inspectable plan. */
export function planNoteTagRename(
  notes: readonly Note[],
  rawFrom: string,
  rawTo: string,
): NoteTagRenamePlan | NoteTagRenameError {
  const from = normalizeTag(rawFrom);
  const to = normalizeTag(rawTo);
  if (!isValidNewTag(to)) return "invalid-name";
  if (to === from) return "unchanged";
  const carrying = notes.filter((note) => note.tags.some((tag) => normalizeTag(tag) === from));
  if (carrying.length === 0) return "nothing-to-rename";
  const writable = carrying.filter((note) => noteAllowsTagAssignment(note, true));
  if (writable.length === 0) return "nothing-to-rename";
  return {
    from,
    to,
    notes: writable,
    mergedIds: writable
      .filter((note) => note.tags.some((tag) => normalizeTag(tag) === to))
      .map((note) => note.id),
    skippedCount: carrying.length - writable.length,
  };
}

/** The note's tag list after the rename, deduped, preserving position. */
export function noteTagsAfterRename(tags: readonly string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const next = normalizeTag(tag) === from ? to : tag;
    if (!out.some((existing) => normalizeTag(existing) === normalizeTag(next))) out.push(next);
  }
  return out;
}
