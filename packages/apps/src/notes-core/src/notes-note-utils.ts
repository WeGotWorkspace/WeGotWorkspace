import { markdownToPlainText, noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import type { Note } from "@/lib/models/note";
import { sortNotesDesc } from "@/notes-core/src/notes-date-utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { canCreateInNotebook, findNotebookCollection } from "@/notes-core/src/notes-notebook-write";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";
import { isNotesPersistGone } from "@/notes-core/src/notes-persist-access";
import { normalizeTag } from "@/lib/models/note-tag";
import {
  applyNoteBodyMarkdown,
  enrichNote,
  noteHasListableBody,
  noteTagsEqual,
  usableNoteListPreview,
} from "@/lib/models/note-list-model";

export {
  isValidNewTag,
  normalizeTag,
  noteTagToggle,
  noteTagsAfterAdd,
  noteTagsAfterToggle,
  noteTagDelta,
} from "@/lib/models/note-tag";

export function persistBestEffort(promise: Promise<unknown>, onGone?: () => void) {
  promise.catch((error) => {
    if (onGone && isNotesPersistGone(error)) onGone();
  });
}

/** Delay after the last edit before flushing a debounced API save (ms). */
export const AUTOSAVE_WRITE_DEBOUNCE_MS = 1200;

export { createNoteSaveDebouncer } from "@/notes-core/src/notes-save-debouncer";

const NOTE_LIST_TITLE_MAX = 80;

/** Title-line placeholder when SUMMARY is empty. Body text stays on the excerpt line. */
export const NOTE_LIST_EMPTY_TITLE = "Empty title";

/** Enough text for a two-line list preview; the rest of a long note is never read. */
const NOTE_LIST_PREVIEW_MAX = 240;

/**
 * Markdown as one readable preview line: headings, code blocks and tables are left
 * out, each remaining block is plain text, and blocks that do not end a sentence
 * (list items, short lines) are joined with a middle dot.
 */
export function notePreviewFromMarkdown(markdown: string): string {
  let preview = "";
  let inCode = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line || /^#{1,6}\s/.test(line) || line.startsWith("|")) continue;
    const text = markdownToPlainText(line);
    if (!text) continue;
    if (!preview) preview = text;
    else preview += /[.!?…:;]$/.test(preview) ? ` ${text}` : ` · ${text}`;
    if (preview.length >= NOTE_LIST_PREVIEW_MAX) break;
  }
  return preview;
}

/**
 * Preview under the list row title: the body as readable text (see
 * {@link notePreviewFromMarkdown}), else the stored excerpt. An empty title does
 * not hide it.
 */
export function noteListExcerpt(
  note: Pick<Note, "excerpt" | "body"> & { id?: string; title?: string },
): string {
  const fromBody = usableNoteListPreview(
    notePreviewFromMarkdown(noteBodyToMarkdown(note.body ?? [])),
    note.id,
  );
  if (fromBody) return fromBody;
  return usableNoteListPreview(notePreviewFromMarkdown(note.excerpt ?? ""), note.id);
}

/** List-row heading: SUMMARY when set, otherwise {@link NOTE_LIST_EMPTY_TITLE}. */
export function noteListTitle(
  note: Pick<Note, "excerpt" | "body"> & { id?: string; title?: string },
): string {
  const titled = note.title?.trim();
  if (!titled) return NOTE_LIST_EMPTY_TITLE;
  return titled.length <= NOTE_LIST_TITLE_MAX
    ? titled
    : `${titled.slice(0, NOTE_LIST_TITLE_MAX - 1)}…`;
}

type NoteShareAudienceFields = Pick<
  Note,
  "sharedInbox" | "sharedNotebookGrant" | "sharedBy" | "scope"
>;

/**
 * Personal share recipient: Shared-with-me file grant, or a note under a
 * personally shared notebook (ACL dir grant from another user). Group notebooks
 * are not personal shares — members keep tags. Stars are per user and show for everyone.
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

function noteDisplayTimestampMs(note: Pick<Note, "date" | "updatedAt">): number {
  const raw = note.date !== "—" ? note.date : note.updatedAt;
  if (!raw || raw === "—") return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
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
  // Trim only to test for content. The title field is controlled by this value,
  // so returning a trimmed copy ate a space typed just before a save landed.
  if (local.title?.trim()) return local.title;
  if (saved.title?.trim()) return saved.title;
  return undefined;
}

export function mergeCreatedNotePreservingLocalOptimistic(saved: Note, local: Note): Note {
  const tagsDiffer = !noteTagsEqual(local.tags, saved.tags);
  const starredDiffer = local.starred !== saved.starred;
  const archivedDiffer = (local.archived ?? false) !== (saved.archived ?? false);
  // Metadata PUT/PATCH omits body — the response still carries on-disk DESCRIPTION,
  // which is often stale vs the collab preview. Keep any local listable body.
  const preserveBody = noteHasListableBody(local);
  const title = noteTitleForMerge(local, saved);
  const titleDiffer = (title?.trim() ?? "") !== (saved.title?.trim() ?? "");
  const notebook = local.notebook || saved.notebook;
  const preserveNotebook = !!local.notebook && local.notebook !== saved.notebook;
  // When keeping optimistic metadata, ensure display date is at least the
  // server row's so a follow-up bootstrap merge (local date >= server) keeps
  // the same tags/title — even if the create response clock is ahead of the client.
  const date =
    tagsDiffer || starredDiffer || archivedDiffer || titleDiffer || preserveNotebook
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
    archived: local.archived !== undefined ? local.archived : saved.archived,
    notebook,
    date,
    ...(preserveNotebook
      ? {
          notebookId: local.notebookId,
          scope: local.scope,
          groupSlug: local.groupSlug,
        }
      : {}),
    ...(title ? { title } : {}),
    ...(preserveBody
      ? { body: local.body, excerpt: local.excerpt, wordCount: local.wordCount }
      : {}),
  });
}

/**
 * Merge bootstrap/server notes into current UI notes without dropping optimistic
 * tags/starred/archived/notebook/title that are still ahead of a stale list payload (same id),
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

    const localNewer = noteDisplayTimestampMs(local) > noteDisplayTimestampMs(server);
    const preserveTags = localNewer && !noteTagsEqual(local.tags, server.tags);
    const preserveStarred =
      localNewer && local.starred !== undefined && local.starred !== server.starred;
    const preserveArchived =
      localNewer && local.archived !== undefined && local.archived !== server.archived;
    const preserveNotebook = localNewer && !!local.notebook && local.notebook !== server.notebook;
    const preserveBody = noteHasListableBody(local) && (!noteHasListableBody(server) || localNewer);
    const localTitle = local.title?.trim();
    const serverTitle = server.title?.trim();
    const preserveTitle =
      !!localTitle && (!serverTitle || (localNewer && localTitle !== serverTitle));

    return enrichNote({
      ...server,
      ...(preserveTags ? { tags: local.tags } : {}),
      ...(preserveStarred ? { starred: local.starred } : {}),
      ...(preserveArchived ? { archived: local.archived } : {}),
      ...(preserveNotebook
        ? {
            notebook: local.notebook,
            notebookId: local.notebookId,
            scope: local.scope,
            groupSlug: local.groupSlug,
          }
        : {}),
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

  // Keep notes made here that a stale list payload has not seen yet. Dropping
  // them cleared selection and made a just-titled note vanish from editor + list.
  // An empty note stays too: Notes keep a created VJOURNAL even when it is empty.
  const serverIds = new Set(serverNotes.map((note) => note.id));
  for (const local of localNotes) {
    if (!serverIds.has(local.id) && local.createPending) merged.push(enrichNote(local));
  }
  return merged;
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

/** Archived map is UI-owned; note.archived is the persisted row flag — honor both. */
export function noteIsArchived(note: Note, archived: Record<string, boolean>): boolean {
  return !!archived[note.id] || !!note.archived;
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
    const isArchived = noteIsArchived(note, archived);
    let inView = true;
    if (view === "all") {
      inView = !note.sharedInbox && !note.sharedNotebookGrant && !isArchived;
    } else if (view === "starred") {
      // A star is the caller's own, so Starred also lists notes shared with them.
      inView = !!starred[note.id] && !isArchived;
    } else if (view === "archive") {
      inView = !note.sharedInbox && !note.sharedNotebookGrant && isArchived;
    } else if (view === "shared-with-me") {
      inView =
        !isArchived &&
        !note.sharedInbox &&
        !note.sharedNotebookGrant &&
        noteMatchesSharedNotebook(note, sharedNotebookKeys);
    } else if (view.startsWith("shared-nb:")) {
      const parsed = parseGroupNotebookPath(view.slice("shared-nb:".length));
      inView =
        parsed !== null &&
        note.notebook === parsed.notebook &&
        note.groupSlug === parsed.groupSlug &&
        !isArchived;
    } else if (view.startsWith("nb:")) {
      const target = view.slice(3);
      inView =
        !note.sharedInbox &&
        (note.notebookId === target ||
          note.notebook === target ||
          note.notebook.toLowerCase() === target.toLowerCase()) &&
        !isArchived;
    } else if (view.startsWith("tag:")) {
      const target = normalizeTag(view.slice(4));
      inView =
        !note.sharedInbox &&
        !note.sharedNotebookGrant &&
        note.tags.some((tag) => normalizeTag(tag) === target) &&
        !isArchived;
    }
    if (!inView) return false;
    if (!q) return true;
    const liveName = notebookDisplayName(note, notebookCollections ?? []);
    return noteSearchText(note, liveName).includes(q);
  });
  return sortNotesDesc(filtered);
}

// Lowercased search text per note object. Notes are replaced, not mutated, so a
// changed note gets a new entry and unchanged notes skip the join (#1714).
const noteSearchTextCache = new WeakMap<Note, { liveName: string; text: string }>();

function noteSearchText(note: Note, liveName: string): string {
  const cached = noteSearchTextCache.get(note);
  if (cached?.liveName === liveName) return cached.text;
  const text =
    `${note.title ?? ""} ${note.excerpt} ${note.body.join(" ")} ${note.notebook} ${liveName} ${note.tags.join(" ")}`.toLowerCase();
  noteSearchTextCache.set(note, { liveName, text });
  return text;
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

/** Whether New note is allowed for the current sidebar/list view. */
export function notesCanCreateInView(
  view: string,
  notebookCollections: readonly Pick<NotesNotebookCollection, "id" | "name" | "myRights">[] = [],
): boolean {
  if (view === "shared-with-me") {
    return false;
  }
  if (view.startsWith("shared-nb:")) {
    return parseGroupNotebookPath(view.slice("shared-nb:".length)) !== null;
  }
  if (view.startsWith("nb:")) {
    const key = view.slice(3);
    return canCreateInNotebook(findNotebookCollection(notebookCollections, key));
  }
  return true;
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
  if (byName?.name.trim()) return byName.name;
  const byStoredId = collections.find((item) => item.id === note.notebook);
  return byStoredId?.name ?? note.notebook;
}

/**
 * List/detail location line: live collection display name (same as the sidebar
 * row / Tasks `taskListName`), grantor username for Shared-with-me file grants.
 * Group-membership notebooks are My notebooks — never the `group-…` id/slug.
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
  const notebook = notebookDisplayName(note, collections).trim();
  return notebook || null;
}
