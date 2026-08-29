import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { formatNoteDateForList } from "@/notes-core/src/notes-date-utils";
import type { Note } from "@/lib/models/note";

/** Used when bootstrap seed has no rows (edge case for isolated stories). */
const FALLBACK_NOTE: Note = {
  id: "story-note-fallback",
  category: "Note",
  date: new Date().toISOString(),
  excerpt: "A short preview line for Storybook layouts.",
  body: ["First paragraph for the composer.", "Optional second paragraph."],
  notebook: "Drafts",
  tags: ["demo"],
  wordCount: 12,
};

export function getNotesStoryFirstNote(): Note {
  const { data } = createNotesAppBootstrap();
  return data.notes[0] ?? FALLBACK_NOTE;
}

export function getNotesDetailStoryProps(opts?: { pullQuote?: string; extraBody?: boolean }) {
  const n = getNotesStoryFirstNote();
  const body = opts?.extraBody
    ? [...n.body, "Additional paragraph for taller scroll previews."]
    : n.body;

  return {
    noteId: n.id,
    notebook: n.notebook,
    lastEdited: formatNoteDateForList(n.date),
    editedLabel: "Last edited ",
    title: n.title ?? n.excerpt,
    tags: n.tags,
    pullQuote: opts?.pullQuote ?? n.pullQuote,
    body,
  };
}
