import {
  markdownToNoteBody,
  markdownToPlainText,
  noteBodyToMarkdown,
} from "@/lib/models/note-body-markdown";
import type { Note } from "@/lib/models/note";
import { compareNotesDesc } from "@/notes-core/src/notes-date-utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

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
  // Re-strip so stale excerpts (or server listPreview) never leak raw markdown.
  const excerpt = markdownToPlainText(note.excerpt ?? "");
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

type NoteShareAudienceFields = Pick<
  Note,
  "sharedInbox" | "sharedNotebookGrant" | "sharedBy" | "scope"
>;

/**
 * Personal share recipient: Shared-with-me file grant, or a note under a
 * personally shared notebook (ACL dir grant from another user). Group notebooks
 * are not personal shares — members keep tags/stars.
 */
export function isPersonalShareRecipient(note: NoteShareAudienceFields): boolean {
  if (note.sharedInbox) return true;
  if (note.sharedBy?.trim()) return true;
  if (note.sharedNotebookGrant && note.scope !== "group") return true;
  return false;
}

/** Tag chips + add-tag UI — hidden for personal share recipients. */
export function noteShowsTags(note: NoteShareAudienceFields): boolean {
  return !isPersonalShareRecipient(note);
}

/**
 * Tag assignment: never for personal share recipients; otherwise when the note
 * body/metadata is editable (owner, or group collab with edit rights).
 */
export function noteAllowsTagAssignment(
  note: NoteShareAudienceFields,
  mayEditContent: boolean,
): boolean {
  return noteShowsTags(note) && mayEditContent;
}

/** Star/unstar controls — same personal-share audience as hidden tags. */
export function noteShowsStarControls(note: NoteShareAudienceFields): boolean {
  return !isPersonalShareRecipient(note);
}

/**
 * List-row “View only” chip — only when list payload says the current user
 * cannot edit content (shared view grant). Owned / edit / full omit the chip.
 */
export function noteShowsViewOnlyBadge(note: Pick<Note, "myRights">): boolean {
  return note.myRights?.mayEditContent === false;
}

/**
 * Owner “Shared” chip — outgoing grants on an owned note (not incoming
 * Shared-with-me / shared-notebook recipient stubs).
 */
export function noteShowsSharedBadge(
  note: Pick<Note, "isShared" | "sharedInbox" | "sharedNotebookGrant">,
): boolean {
  if (note.sharedInbox || note.sharedNotebookGrant) return false;
  return note.isShared === true;
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
  if (normalizeNoteBodyMarkdown(noteBodyToMarkdown(note.body)) === normalized) {
    return note;
  }
  const bumpDate = options?.bumpDate !== false;
  return enrichNote({
    ...note,
    body: markdownToNoteBody(normalized),
    ...(bumpDate ? { date: options?.editedAt ?? new Date().toISOString() } : {}),
  });
}

/**
 * Update one note’s body in a list, returning the **same array reference** when
 * markdown is unchanged — required so hydrate/Yjs notify loops do not setState.
 */
export function mapNotesWithBodyMarkdown(
  notes: Note[],
  id: string,
  markdown: string,
  options?: { editedAt?: string; bumpDate?: boolean },
): { notes: Note[]; updated: Note | undefined } {
  let updated: Note | undefined;
  const nextNotes = notes.map((note) => {
    if (note.id !== id) return note;
    const next = applyNoteBodyMarkdown(note, markdown, options);
    if (next !== note) updated = next;
    return next;
  });
  return { notes: updated ? nextNotes : notes, updated };
}

/**
 * Keep the first occurrence when `notes` accidentally contains duplicate ids
 * (React list keys + selection would otherwise treat both rows as one id).
 */
export function dedupeNotesById(notes: Note[]): Note[] {
  if (notes.length <= 1) return notes;
  const seen = new Set<string>();
  const result: Note[] = [];
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    result.push(note);
  }
  return result.length === notes.length ? notes : result;
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
  const filtered = dedupeNotesById(notes).filter((note) => {
    let inView = true;
    if (view === "all") {
      inView = !note.sharedInbox && !note.sharedNotebookGrant && !archived[note.id];
    } else if (view === "starred") {
      inView =
        !note.sharedInbox && !note.sharedNotebookGrant && !!starred[note.id] && !archived[note.id];
    } else if (view === "archive") {
      inView = !note.sharedInbox && !note.sharedNotebookGrant && !!archived[note.id];
    } else if (view === "shared-with-me") inView = !!note.sharedInbox && !archived[note.id];
    else if (view.startsWith("shared-nb:")) {
      const notebookPath = view.slice("shared-nb:".length);
      inView = noteBelongsToSharedNotebook(note, notebookPath) && !archived[note.id];
    } else if (view.startsWith("nb:")) {
      const target = view.slice(3);
      inView =
        !note.sharedInbox &&
        !note.sharedNotebookGrant &&
        note.scope !== "group" &&
        (note.notebook === target || note.notebook.toLowerCase() === target.toLowerCase()) &&
        !archived[note.id];
    } else if (view.startsWith("tag:")) {
      inView =
        !note.sharedInbox &&
        !note.sharedNotebookGrant &&
        note.tags.includes(view.slice(4)) &&
        !archived[note.id];
    }
    if (!inView) return false;
    if (!q) return true;
    const haystack =
      `${note.excerpt} ${note.body.join(" ")} ${note.notebook} ${note.tags.join(" ")}`.toLowerCase();
    return haystack.includes(q);
  });
  return filtered.sort(compareNotesDesc);
}

/**
 * Parse `groups/{slug}/.notes/{notebook}` (with optional leading slash).
 * Used for Shared notebooks membership paths — not personal ACL shares.
 */
export function parseGroupNotebookPath(
  path: string,
): { groupSlug: string; notebook: string } | null {
  const normalized = path.replace(/\/+$/, "").replace(/^\//, "");
  const match = /^groups\/([^/]+)\/\.notes\/([^/]+)$/i.exec(normalized);
  if (!match) return null;
  return { groupSlug: match[1]!, notebook: match[2]! };
}

/** Whether New note is allowed for the current sidebar/list view. */
export function notesCanCreateInView(view: string): boolean {
  if (view === "starred" || view === "archive" || view === "shared-with-me") {
    return false;
  }
  if (view.startsWith("shared-nb:")) {
    // Group membership notebooks: members can create. Personal ACL shares: no
    // (API create is owner home or groupSlug only).
    return parseGroupNotebookPath(view.slice("shared-nb:".length)) !== null;
  }
  return true;
}

export type NotesCreateTarget = {
  notebook: string;
  scope?: "group";
  groupSlug?: string;
};

/** Resolve notebook (+ optional group scope) for a new note from the active view. */
export function resolveNotesCreateTarget(
  view: string,
  personalNotebooks: string[],
): NotesCreateTarget {
  if (view.startsWith("shared-nb:")) {
    const parsed = parseGroupNotebookPath(view.slice("shared-nb:".length));
    if (parsed) {
      return {
        notebook: parsed.notebook,
        scope: "group",
        groupSlug: parsed.groupSlug,
      };
    }
  }
  if (view.startsWith("nb:")) {
    return { notebook: view.slice(3) };
  }
  return { notebook: personalNotebooks[0] ?? "Drafts" };
}

/** Whether a note lives under a shared notebook directory path. */
export function noteBelongsToSharedNotebook(note: Note, notebookPath: string): boolean {
  const dir = notebookPath.replace(/\/+$/, "").replace(/^\//, "");
  if (!dir) return false;
  if (note.apiPath?.trim()) {
    const file = note.apiPath.replace(/^\//, "").replace(/\/+$/, "");
    return file === dir || file.startsWith(`${dir}/`);
  }
  if (note.scope === "group" && note.groupSlug?.trim()) {
    const expected = `groups/${note.groupSlug.trim()}/.notes/${note.notebook}`;
    return expected === dir;
  }
  return false;
}

/**
 * Sidebar / chrome label for a shared notebook entry.
 * Personal ACL shares: notebook name only (not “Shared by …” — that is for file grants).
 * Groups: group name only (not “General” + slug).
 */
export function sharedNotebookLabel(entry: {
  notebook: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
}): string {
  if (entry.scope === "group") {
    const group = (entry.groupSlug ?? entry.owner).trim();
    return group || entry.notebook;
  }
  return entry.notebook;
}

/**
 * List/detail location line: notebook name for owned notes, group name for
 * group-scoped notes, “Shared by …” for Shared-with-me file grants (mirrors
 * Drive/Docs shared location labeling).
 */
export function noteListLocationLabel(
  note: Pick<Note, "notebook" | "sharedInbox" | "sharedBy" | "scope" | "groupSlug">,
  labels: Pick<NotesUILabels, "sharedBy" | "sidebarSharedWithMe">,
): string | null {
  if (note.sharedInbox) {
    const who = note.sharedBy?.trim();
    return who ? labels.sharedBy(who) : labels.sidebarSharedWithMe;
  }
  if (note.scope === "group") {
    const group = note.groupSlug?.trim();
    if (group) return group;
  }
  const notebook = note.notebook.trim();
  return notebook || null;
}
