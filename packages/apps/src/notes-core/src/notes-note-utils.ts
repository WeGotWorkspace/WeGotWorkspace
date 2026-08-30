import {
  markdownToNoteBody,
  markdownToPlainText,
  noteBodyToMarkdown,
} from "@/lib/models/note-body-markdown";
import type { Note } from "@/lib/models/note";
import { compareNotesDesc } from "@/notes-core/src/notes-date-utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { isNotesPersistGone } from "@/notes-core/src/notes-persist-access";
import { autofillNoteTitle } from "@/notes-core/src/notes-title-autofill";

export function persistBestEffort(promise: Promise<unknown>, onGone?: () => void) {
  promise.catch((error) => {
    // 404: collection object is gone — drop the local ghost (see isNotesPersistGone).
    if (onGone && isNotesPersistGone(error)) onGone();
  });
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
  const pending = new Map<string, { note: Note; persist: PersistFn }>();

  function arm(noteId: string, delay: number): void {
    const existing = timers.get(noteId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const p = pending.get(noteId);
      if (p) {
        p.persist(p.note);
        pending.delete(noteId);
      }
      timers.delete(noteId);
    }, delay);
    timers.set(noteId, timer);
  }

  function schedule(noteId: string, note: Note, persist: PersistFn): void {
    pending.set(noteId, { note, persist });
    arm(noteId, delayMs);
  }

  function flushAll(persist: PersistFn): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const row of pending.values()) {
      persist(row.note);
    }
    timers.clear();
    pending.clear();
  }

  /** Move a pending save onto the remapped server id so title/metadata PATCH hits the UID. */
  function remapId(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const row = pending.get(fromId);
    const timer = timers.get(fromId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(fromId);
    }
    if (!row) return;
    pending.delete(fromId);
    pending.set(toId, { note: { ...row.note, id: toId }, persist: row.persist });
    arm(toId, delayMs);
  }

  return { schedule, flushAll, remapId };
}

export function plainTextFromBody(body: string[] | undefined): string {
  return markdownToPlainText(noteBodyToMarkdown(body ?? []));
}

/** Offline-created notes keep `local-*` ids as the `.md` filename / FileNode name. */
const LOCAL_NOTE_ID_RE = /^local-[0-9a-f-]+$/i;

/**
 * True when a list label is a filename / id placeholder, not a human title.
 * FileNode `parse()` uses the note id as `fallbackTitle` when frontmatter is
 * empty — that must never become the list heading.
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

/**
 * Docs-style “untitled + empty body → delete” is off for Notes.
 * A created VJOURNAL stays, even with empty SUMMARY and DESCRIPTION.
 */
export function shouldDiscardEmptyCreatedNote(
  _note: Pick<Note, "title" | "body" | "excerpt">,
): boolean {
  return false;
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

/** Body excerpt for the list row. Omitted when it would duplicate the title fallback. */
export function noteListExcerpt(
  note: Pick<Note, "excerpt" | "body"> & { id?: string; title?: string },
): string {
  const titled = note.title?.trim();
  const excerpt = usableNoteListPreview(markdownToPlainText(note.excerpt ?? ""), note.id);
  if (!excerpt) return "";
  if (!titled) return "";
  return excerpt;
}

/** List-row heading: SUMMARY when set, otherwise excerpt/body until autofill. */
export function noteListTitle(
  note: Pick<Note, "excerpt" | "body"> & { id?: string; title?: string },
): string {
  const titled = note.title?.trim();
  if (titled) {
    return titled.length <= NOTE_LIST_TITLE_MAX
      ? titled
      : `${titled.slice(0, NOTE_LIST_TITLE_MAX - 1)}…`;
  }
  // Re-strip so stale excerpts (or server listPreview) never leak raw markdown.
  const excerpt = usableNoteListPreview(markdownToPlainText(note.excerpt ?? ""), note.id);
  if (excerpt) {
    const withoutEllipsis = excerpt.endsWith("…") ? excerpt.slice(0, -1).trim() : excerpt;
    return withoutEllipsis.length <= NOTE_LIST_TITLE_MAX
      ? withoutEllipsis
      : `${withoutEllipsis.slice(0, NOTE_LIST_TITLE_MAX - 1)}…`;
  }
  const text = usableNoteListPreview(plainTextFromBody(note.body), note.id);
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
 * cannot edit content (shared view grant). Owned / edit omit the icon.
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
  const excerpt = computeExcerpt(body);
  return {
    ...note,
    body,
    excerpt: usableNoteListPreview(excerpt, note.id),
    wordCount: noteHasListableBody({ ...note, body }) ? computeWordCount(body) : 0,
  };
}

function noteDisplayTimestampMs(note: Pick<Note, "date" | "updatedAt">): number {
  const raw = note.date !== "—" ? note.date : note.updatedAt;
  if (!raw || raw === "—") return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Order-independent tag list equality after normalize. */
export function noteTagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map(normalizeTag).filter(Boolean).sort();
  const right = [...b].map(normalizeTag).filter(Boolean).sort();
  return left.every((tag, i) => tag === right[i]);
}

/**
 * Apply a create/upsert server row onto the in-memory note, keeping optimistic
 * tags/starred (and listable body) that landed while the request was in flight.
 *
 * Tag upserts ride the workspace write queue (~2.5s), so create remap often
 * returns first with an empty `tags` array — replacing wholesale made chips
 * vanish until the delayed upsert / a later refresh.
 */
function noteTitleForMerge(local: Note, saved: Note): string | undefined {
  const localTitle = local.title?.trim();
  const savedTitle = saved.title?.trim();
  return localTitle || savedTitle || undefined;
}

export function mergeCreatedNotePreservingLocalOptimistic(saved: Note, local: Note): Note {
  const tagsDiffer = !noteTagsEqual(local.tags, saved.tags);
  const starredDiffer = local.starred !== saved.starred;
  const preserveBody = noteHasListableBody(local) && !noteHasListableBody(saved);
  const title = noteTitleForMerge(local, saved);
  const titleDiffer = (title ?? "") !== (saved.title?.trim() ?? "");
  // When keeping optimistic metadata, ensure display date is at least the
  // server row's so a follow-up bootstrap merge (local date >= server) keeps
  // the same tags/title — even if the create response clock is ahead of the client.
  const date =
    tagsDiffer || starredDiffer || titleDiffer
      ? noteDisplayTimestampMs(local) >= noteDisplayTimestampMs(saved)
        ? local.date
        : saved.date
      : preserveBody && local.date !== "—"
        ? local.date
        : saved.date;
  return enrichNote({
    ...saved,
    tags: local.tags,
    starred: local.starred ?? saved.starred,
    notebook: local.notebook || saved.notebook,
    date,
    ...(title ? { title } : {}),
    ...(preserveBody
      ? { body: local.body, excerpt: local.excerpt, wordCount: local.wordCount }
      : {}),
  });
}

/**
 * Merge bootstrap/server notes into current UI notes without dropping optimistic
 * tags/starred/archived/title that are still ahead of a stale list payload (same id),
 * and without dropping in-flight local-* creates the list has not seen yet.
 */
export function mergeBootstrapNotesPreservingOptimistic(
  serverNotes: Note[],
  localNotes: Note[],
): Note[] {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const merged = serverNotes.map((server) => {
    const local = localById.get(server.id);
    if (!local) return enrichNote(server);

    const localNewerOrEqual = noteDisplayTimestampMs(local) >= noteDisplayTimestampMs(server);
    const preserveTags = localNewerOrEqual && !noteTagsEqual(local.tags, server.tags);
    const preserveStarred =
      localNewerOrEqual && local.starred !== undefined && local.starred !== server.starred;
    const preserveArchived =
      localNewerOrEqual && local.archived !== undefined && local.archived !== server.archived;
    const preserveBody = !noteHasListableBody(server) && noteHasListableBody(local);
    const localTitle = local.title?.trim();
    const serverTitle = server.title?.trim();
    const preserveTitle =
      !!localTitle && (!serverTitle || (localNewerOrEqual && localTitle !== serverTitle));

    return enrichNote({
      ...server,
      ...(preserveTags ? { tags: local.tags } : {}),
      ...(preserveStarred ? { starred: local.starred } : {}),
      ...(preserveArchived ? { archived: local.archived } : {}),
      ...(preserveTitle ? { title: local.title } : {}),
      ...(preserveBody
        ? {
            body: local.body,
            excerpt: local.excerpt,
            wordCount: local.wordCount,
            date: local.date !== "—" ? local.date : server.date,
          }
        : {}),
    });
  });

  // Keep in-flight local-* creates a stale list payload has not seen yet. Dropping
  // them cleared selection and made a just-titled note vanish from editor + list.
  // Empty DESCRIPTION is not a discard reason (Notes persist created items).
  const serverIds = new Set(serverNotes.map((note) => note.id));
  for (const local of localNotes) {
    if (!serverIds.has(local.id) && LOCAL_NOTE_ID_RE.test(local.id)) {
      if (shouldDiscardEmptyCreatedNote(local)) continue;
      merged.push(enrichNote(local));
    }
  }
  return merged;
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
  const autofilled = autofillNoteTitle(note.title, normalized);
  const titleChanged = (autofilled ?? undefined) !== (note.title?.trim() || undefined);
  // Compare normalized forms so TipTap trailing newlines do not look like edits
  // (that retriggered hydrate → setNotes → “Maximum update depth exceeded”).
  const bodyUnchanged = normalizeNoteBodyMarkdown(noteBodyToMarkdown(note.body)) === normalized;
  if (bodyUnchanged && !titleChanged) {
    return note;
  }
  const bumpDate = options?.bumpDate !== false && !bodyUnchanged;
  return enrichNote({
    ...note,
    ...(bodyUnchanged ? {} : { body: markdownToNoteBody(normalized) }),
    ...(titleChanged ? { title: autofilled ?? undefined } : {}),
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

/** Aggregate views hide notes from notebooks the user unchecked. A notebook view stays unfiltered. */
export function filterNotesByHiddenNotebooks(
  notes: Note[],
  view: string,
  hiddenNotebookIds: ReadonlySet<string>,
): Note[] {
  if (hiddenNotebookIds.size === 0 || view.startsWith("nb:") || view.startsWith("shared-nb:")) {
    return notes;
  }
  return notes.filter((note) => {
    if (note.notebookId && hiddenNotebookIds.has(note.notebookId)) return false;
    if (hiddenNotebookIds.has(note.notebook)) return false;
    return true;
  });
}

function noteMatchesSharedNotebook(
  note: Note,
  sharedNotebookKeys: ReadonlySet<string> | undefined,
): boolean {
  if (!sharedNotebookKeys || sharedNotebookKeys.size === 0) return false;
  if (note.notebookId && sharedNotebookKeys.has(note.notebookId)) return true;
  return sharedNotebookKeys.has(note.notebook);
}

export function filterVisibleNotes(
  notes: Note[],
  {
    view,
    archived,
    starred,
    searchQuery,
    sharedNotebookKeys,
    notebookCollections,
  }: {
    view: string;
    archived: Record<string, boolean>;
    starred: Record<string, boolean>;
    searchQuery: string;
    /** isSharee notebook ids/names. Leftover `/notes/shared-with-me` — not Drive grants. */
    sharedNotebookKeys?: ReadonlySet<string>;
    /** Live collections so search matches the renamed display name, not a stale cache. */
    notebookCollections?: readonly { id: string; name: string }[];
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
    } else if (view === "shared-with-me") {
      inView =
        !archived[note.id] &&
        !note.sharedInbox &&
        !note.sharedNotebookGrant &&
        noteMatchesSharedNotebook(note, sharedNotebookKeys);
    } else if (view.startsWith("shared-nb:")) {
      const parsed = parseGroupNotebookPath(view.slice("shared-nb:".length));
      inView =
        parsed !== null &&
        note.notebook === parsed.notebook &&
        note.groupSlug === parsed.groupSlug &&
        !archived[note.id];
    } else if (view.startsWith("nb:")) {
      const target = view.slice(3);
      inView =
        !note.sharedInbox &&
        (note.notebookId === target ||
          note.notebook === target ||
          note.notebook.toLowerCase() === target.toLowerCase()) &&
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
    const liveName = notebookDisplayName(note, notebookCollections ?? []);
    const haystack =
      `${note.title ?? ""} ${note.excerpt} ${note.body.join(" ")} ${note.notebook} ${liveName} ${note.tags.join(" ")}`.toLowerCase();
    return haystack.includes(q);
  });
  return filtered.sort(compareNotesDesc);
}

/**
 * Parse `groups/{slug}/.notes/{notebook}` (with optional leading slash).
 * Used for leftover group-membership notebook paths (`shared-nb:`).
 */
export function parseGroupNotebookPath(
  path: string,
): { groupSlug: string; notebook: string } | null {
  const normalized = path.replace(/\/+$/, "").replace(/^\//, "");
  const match = /^groups\/([^/]+)\/\.notes\/([^/]+)$/i.exec(normalized);
  if (!match) return null;
  return { groupSlug: match[1]!, notebook: match[2]! };
}

/**
 * Starred and Archive keep New enabled; create switches to All Items first
 * so the note is a normal default-notebook item (not starred or cancelled).
 */
export function notesViewForCreate(view: string): string {
  if (view === "starred" || view === "archive") return "all";
  return view;
}

/**
 * After a notebook move: stay on All / Starred / Archive / Tags / shared
 * filters when the note still belongs there. Leave a single-notebook view
 * (or any filter that no longer contains the note) for the destination.
 */
export function notesViewAfterNotebookMove(
  view: string,
  dest: { id: string; name: string },
  movedNote: Note,
  filter: {
    archived: Record<string, boolean>;
    starred: Record<string, boolean>;
    sharedNotebookKeys?: ReadonlySet<string>;
    notebookCollections?: readonly { id: string; name: string }[];
  },
): string {
  const destView = `nb:${dest.id || dest.name}`;
  const stillInView =
    filterVisibleNotes([movedNote], {
      view,
      archived: filter.archived,
      starred: filter.starred,
      searchQuery: "",
      sharedNotebookKeys: filter.sharedNotebookKeys,
      notebookCollections: filter.notebookCollections,
    }).length > 0;
  return stillInView ? view : destView;
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

/** Whether New note is allowed for the current sidebar/list view. */
export function notesCanCreateInView(view: string): boolean {
  if (view === "shared-with-me") {
    return false;
  }
  if (view.startsWith("shared-nb:")) {
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
 * Personal ACL shares: notebook name only (grantor username is for file grants).
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

/** Resolve notebook display name from the live collections list (Tasks `taskListName` pattern). */
export function notebookDisplayName(
  note: Pick<Note, "notebook" | "notebookId">,
  collections: readonly { id: string; name: string }[] = [],
): string {
  if (note.notebookId) {
    const byId = collections.find((item) => item.id === note.notebookId);
    if (byId?.name.trim()) return byId.name;
  }
  const byName = collections.find((item) => item.name === note.notebook);
  return byName?.name ?? note.notebook;
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

/**
 * List/detail location line: notebook name for owned notes, group name for
 * group-scoped notes, grantor username for Shared-with-me file grants.
 */
export function noteListLocationLabel(
  note: Pick<Note, "notebook" | "notebookId" | "sharedInbox" | "sharedBy" | "scope" | "groupSlug">,
  labels: Pick<NotesUILabels, "sharedBy" | "sidebarSharedWithMe">,
  collections: readonly { id: string; name: string }[] = [],
): string | null {
  if (note.sharedInbox) {
    const who = note.sharedBy?.trim();
    return who ? labels.sharedBy(who) : labels.sidebarSharedWithMe;
  }
  if (note.scope === "group") {
    const group = note.groupSlug?.trim();
    if (group) return group;
  }
  const notebook = notebookDisplayName(note, collections).trim();
  return notebook || null;
}
