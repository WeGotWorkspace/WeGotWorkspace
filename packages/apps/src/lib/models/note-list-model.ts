/**
 * Note list model: preview text, word count, excerpt, tag and body merges.
 * Shared by the Notes app and the offline note store.
 */
import type { Note } from "@/lib/models/note";
import {
  markdownToNoteBody,
  markdownToPlainText,
  noteBodyToMarkdown,
} from "@/lib/models/note-body-markdown";
import { normalizeTag } from "@/lib/models/note-tag";

export function plainTextFromBody(body: string[] | undefined): string {
  return markdownToPlainText(noteBodyToMarkdown(body ?? []));
}

/** Temporary id an older app gave offline-created notes; it may still show as a label. */
const LOCAL_NOTE_ID_RE = /^local-[0-9a-f-]+$/i;

/**
 * True when a list label is a filename / id placeholder, not a human title.
 * Untitled / id-shaped labels must never become the list heading.
 */
export function isPlaceholderNoteListLabel(text: string, noteId?: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.localeCompare("Untitled", undefined, { sensitivity: "accent" }) === 0) {
    return true;
  }
  if (noteId && trimmed === noteId) return true;
  return LOCAL_NOTE_ID_RE.test(trimmed);
}

/** Body-first list preview text, or empty when the value is only an id / Untitled. */
export function usableNoteListPreview(text: string, noteId?: string): string {
  const trimmed = text.trim();
  return isPlaceholderNoteListLabel(trimmed, noteId) ? "" : trimmed;
}

/** True when the note has plain-text body content suitable for list preview/title. */
export function noteHasListableBody(note: Pick<Note, "body"> & { id?: string }): boolean {
  return usableNoteListPreview(plainTextFromBody(note.body), note.id).length > 0;
}

export function computeWordCount(body: string[]): number {
  return plainTextFromBody(body).split(/\s+/).filter(Boolean).length;
}

export function computeExcerpt(body: string[]): string {
  const text = plainTextFromBody(body);
  if (text.length <= 180) return text;
  return `${text.slice(0, 179)}…`;
}

/**
 * Recomputes excerpt + word count from body. Call on every hydrate/read path so
 * historical rows with empty excerpt still preview correctly when body exists.
 */
export function enrichNote(note: Note): Note {
  const body = Array.isArray(note.body) && note.body.length > 0 ? note.body : [""];
  const excerpt = computeExcerpt(body);
  return {
    ...note,
    body,
    excerpt: usableNoteListPreview(excerpt, note.id),
    wordCount: noteHasListableBody({ ...note, body }) ? computeWordCount(body) : 0,
  };
}

/** Order-independent tag list equality after normalize. */
export function noteTagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map(normalizeTag).filter(Boolean).sort();
  const right = [...b].map(normalizeTag).filter(Boolean).sort();
  return left.every((tag, i) => tag === right[i]);
}

/**
 * Merge local (cache/outbox) notes with a fresh server list for read-path previews.
 *
 * Local metadata wins when present, but an empty local body must not clobber a
 * non-empty server body — that left historical rows stuck on “Untitled note”
 * until the user re-edited (collab optimistic sync).
 */
export function backfillNotesContentFromServer(localNotes: Note[], serverNotes: Note[]): Note[] {
  const serverById = new Map(serverNotes.map((note) => [note.id, note]));
  const localIds = new Set(localNotes.map((note) => note.id));

  const merged = localNotes.map((local) => {
    const server = serverById.get(local.id);
    if (!server) return enrichNote(local);
    if (noteHasListableBody(local)) return enrichNote(local);
    if (!noteHasListableBody(server)) return enrichNote(local);
    return enrichNote({
      ...local,
      body: server.body,
      excerpt: server.excerpt,
      wordCount: server.wordCount,
      date: server.date !== "—" ? server.date : local.date,
    });
  });

  for (const server of serverNotes) {
    if (!localIds.has(server.id)) merged.push(enrichNote(server));
  }
  return merged;
}

/**
 * Server membership/metadata wins, but an empty server body must not wipe a
 * non-empty local/cache body.
 *
 * Body edits persist through collab (not the notes outbox), so a silent
 * bootstrap refresh can briefly see an empty API body while Dexie still holds
 * the optimistic list preview — replacing wholesale caused “Untitled note”
 * until the next keystroke.
 */
export function preserveLocalListableBodiesOnServerNotes(
  serverNotes: Note[],
  localNotes: Note[],
): Note[] {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  return serverNotes.map((server) => {
    if (noteHasListableBody(server)) return enrichNote(server);
    const local = localById.get(server.id);
    if (!local || !noteHasListableBody(local)) return enrichNote(server);
    return enrichNote({
      ...server,
      body: local.body,
      excerpt: local.excerpt,
      wordCount: local.wordCount,
      date: local.date !== "—" ? local.date : server.date,
    });
  });
}

/**
 * Apply collab markdown to local list/detail state (body, excerpt, word count,
 * and optionally display date). Does **not** bump {@link Note.updatedAt} — that
 * token stays metadata-invariant for offline `ifInState` guards.
 *
 * Pass `bumpDate: false` when hydrating from a loaded document so opening a note
 * after refresh fills the list preview without pretending the user just edited.
 */
export function normalizeNoteBodyMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").replace(/\n+$/u, "");
}

export function applyNoteBodyMarkdown(
  note: Note,
  markdown: string,
  options?: { editedAt?: string; bumpDate?: boolean },
): Note {
  const normalized = normalizeNoteBodyMarkdown(markdown);
  // Compare normalized forms so TipTap trailing newlines do not look like edits
  // (that retriggered hydrate → setNotes → “Maximum update depth exceeded”).
  // The title lives in the Y.Doc and is not derived from the body here.
  const bodyUnchanged = normalizeNoteBodyMarkdown(noteBodyToMarkdown(note.body)) === normalized;
  if (bodyUnchanged) return note;
  const bumpDate = options?.bumpDate !== false;
  return enrichNote({
    ...note,
    body: markdownToNoteBody(normalized),
    ...(bumpDate ? { date: options?.editedAt ?? new Date().toISOString() } : {}),
  });
}

/** Stamp dest collection id/name/scope so a move persist does not keep the source groupSlug. */
export function noteAfterNotebookMove(
  note: Note,
  dest: { id: string; name: string; scope?: "personal" | "group"; groupSlug?: string | null },
): Note {
  const groupSlug = dest.scope === "group" ? dest.groupSlug?.trim() || undefined : undefined;
  return {
    ...note,
    notebook: dest.name,
    notebookId: dest.id,
    scope: dest.scope === "group" && groupSlug ? "group" : "personal",
    groupSlug,
  };
}

/** Rewrite denormalized `note.notebook` after a collection rename. */
export function notesWithRenamedNotebook(
  notes: readonly Note[],
  {
    notebookId,
    fromName,
    toName,
  }: {
    notebookId?: string;
    fromName: string;
    toName: string;
  },
): Note[] {
  const next = toName.trim();
  if (!next || next === fromName) return notes as Note[];
  return notes.map((note) => {
    const matchesId = Boolean(notebookId && note.notebookId === notebookId);
    const matchesName =
      note.notebook === fromName &&
      (!note.notebookId || !notebookId || note.notebookId === notebookId);
    if (!matchesId && !matchesName) return note;
    return { ...note, notebook: next };
  });
}
