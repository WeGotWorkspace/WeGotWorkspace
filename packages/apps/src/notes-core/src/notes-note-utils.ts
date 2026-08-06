import {
  markdownToNoteBody,
  markdownToPlainText,
  noteBodyToMarkdown,
} from "@/lib/models/note-body-markdown";
import type { Note } from "@/lib/models/note";
import { compareNotesDesc } from "@/notes-core/src/notes-date-utils";

export function persistBestEffort(promise: Promise<unknown>) {
  promise.catch(() => {});
}

/** Delay after the last edit before flushing a debounced API save (ms). */
export const AUTOSAVE_WRITE_DEBOUNCE_MS = 1200;

type PersistFn = (note: Note) => void;

/**
 * Per-note debounced save scheduler.
 *
 * Call `schedule(noteId, note, persist)` on each edit; the actual persist call
 * fires only after `delayMs` of inactivity for that note.
 * Call `flushAll(persist)` to immediately fire any pending saves (e.g. on unmount).
 */
export function createNoteSaveDebouncer(delayMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, Note>();

  function schedule(noteId: string, note: Note, persist: PersistFn): void {
    const existing = timers.get(noteId);
    if (existing) clearTimeout(existing);
    pending.set(noteId, note);
    const timer = setTimeout(() => {
      const p = pending.get(noteId);
      if (p) {
        persist(p);
        pending.delete(noteId);
      }
      timers.delete(noteId);
    }, delayMs);
    timers.set(noteId, timer);
  }

  function flushAll(persist: PersistFn): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const note of pending.values()) {
      persist(note);
    }
    timers.clear();
    pending.clear();
  }

  return { schedule, flushAll };
}

export function plainTextFromBody(body: string[] | undefined): string {
  return markdownToPlainText(noteBodyToMarkdown(body ?? []));
}

/** True when the note has plain-text body content suitable for list preview/title. */
export function noteHasListableBody(note: Pick<Note, "body">): boolean {
  return plainTextFromBody(note.body).length > 0;
}

export function computeWordCount(body: string[]): number {
  return plainTextFromBody(body).split(/\s+/).filter(Boolean).length;
}

export function computeExcerpt(body: string[]): string {
  const text = plainTextFromBody(body);
  if (text.length <= 180) return text;
  return `${text.slice(0, 179)}…`;
}

const NOTE_LIST_TITLE_MAX = 80;

/** Derives the list-row heading from excerpt or body (notes have no separate title field). */
export function noteListTitle(note: Pick<Note, "excerpt" | "body">): string {
  const excerpt = (note.excerpt ?? "").trim();
  if (excerpt) {
    const withoutEllipsis = excerpt.endsWith("…") ? excerpt.slice(0, -1).trim() : excerpt;
    return withoutEllipsis.length <= NOTE_LIST_TITLE_MAX
      ? withoutEllipsis
      : `${withoutEllipsis.slice(0, NOTE_LIST_TITLE_MAX - 1)}…`;
  }
  const text = plainTextFromBody(note.body).trim();
  if (text) {
    return text.length <= NOTE_LIST_TITLE_MAX ? text : `${text.slice(0, NOTE_LIST_TITLE_MAX - 1)}…`;
  }
  return "Untitled note";
}

/** Max tag chips shown on a notes list row before “+N more”. */
export const NOTE_LIST_MAX_VISIBLE_TAGS = 2;

/** Splits note tags into chips that fit the list row and an overflow count. */
export function noteListTagOverflow(
  tags: string[],
  maxVisible: number = NOTE_LIST_MAX_VISIBLE_TAGS,
): { visible: string[]; overflow: number } {
  const normalized = tags.map(normalizeTag).filter(Boolean);
  if (normalized.length <= maxVisible) {
    return { visible: normalized, overflow: 0 };
  }
  return {
    visible: normalized.slice(0, maxVisible),
    overflow: normalized.length - maxVisible,
  };
}

export function normalizeTag(value: string): string {
  return value.trim();
}

/**
 * Recomputes excerpt + word count from body. Call on every hydrate/read path so
 * historical rows with empty excerpt still preview correctly when body exists.
 */
export function enrichNote(note: Note): Note {
  const body = Array.isArray(note.body) && note.body.length > 0 ? note.body : [""];
  return {
    ...note,
    body,
    excerpt: computeExcerpt(body),
    wordCount: computeWordCount(body),
  };
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
 * Apply collab markdown to local list/detail state (body, excerpt, word count,
 * display date). Does **not** bump {@link Note.updatedAt} — that token stays
 * metadata-invariant for offline `ifInState` guards.
 */
export function applyNoteBodyMarkdown(
  note: Note,
  markdown: string,
  editedAt: string = new Date().toISOString(),
): Note {
  if (noteBodyToMarkdown(note.body) === markdown) {
    return note;
  }
  return enrichNote({
    ...note,
    body: markdownToNoteBody(markdown),
    date: editedAt,
  });
}

export function filterVisibleNotes(
  notes: Note[],
  {
    view,
    archived,
    starred,
    searchQuery,
  }: {
    view: string;
    archived: Record<string, boolean>;
    starred: Record<string, boolean>;
    searchQuery: string;
  },
): Note[] {
  const q = searchQuery.trim().toLowerCase();
  const filtered = notes.filter((note) => {
    let inView = true;
    if (view === "all") inView = !archived[note.id];
    else if (view === "starred") inView = !!starred[note.id] && !archived[note.id];
    else if (view === "archive") inView = !!archived[note.id];
    else if (view.startsWith("nb:")) {
      const target = view.slice(3);
      inView =
        (note.notebook === target || note.notebook.toLowerCase() === target.toLowerCase()) &&
        !archived[note.id];
    } else if (view.startsWith("tag:")) {
      inView = note.tags.includes(view.slice(4)) && !archived[note.id];
    }
    if (!inView) return false;
    if (!q) return true;
    const haystack =
      `${note.excerpt} ${note.body.join(" ")} ${note.notebook} ${note.tags.join(" ")}`.toLowerCase();
    return haystack.includes(q);
  });
  return filtered.sort(compareNotesDesc);
}
