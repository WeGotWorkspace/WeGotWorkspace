import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import type { WgwNoteItem, WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
import { wgwFetchPrincipal } from "@/lib/api/wgw/http";
import {
  archiveNoteViaFileNode,
  createNotebookViaFileNode,
  createNoteViaFileNode,
  deleteNotebookViaFileNode,
  deleteNoteViaFileNode,
  fileNodeNoteProjectionAtPath,
  listOwnedNotesFromFileNodes,
  NotesRequestError,
  parseNoteVirtualPath,
  renameNotebookViaFileNode,
  restoreNoteViaFileNode,
  updateNoteViaFileNode,
} from "@/lib/api/wgw/notes-filenode";
import { fetchDriveSharedWithMe } from "@/lib/api/wgw/drive-shares";
import { usableNoteListPreview } from "@/notes-core/src/notes-note-utils";
import {
  createNote as createVjournalNote,
  deleteNote as deleteVjournalNote,
  fetchNotesVjournalBootstrap,
  getNote,
  listNotebooks,
  noteFromVjournal,
  patchNote,
  patchNotebook,
  starNote,
  unstarNote,
  createNotebook as createVjournalNotebook,
  deleteNotebook as deleteVjournalNotebook,
  type NotesVjournalNotebook,
} from "@/lib/api/wgw/notes-vjournal";

export { NotesRequestError };

// --- JSON → WGW note shapes --------------------------------------------------------------------

export function coerceNoteItem(raw: unknown): WgwNoteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const notebook = r.notebook ?? r.notebookName ?? r.book;
  if (id == null || notebook == null) return null;
  const tagsRaw = r.tags;
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => String(t)) : undefined;
  const username = r.username;
  const scope = r.scope === "group" ? "group" : r.scope === "personal" ? "personal" : undefined;
  return {
    id: String(id),
    notebook: String(notebook),
    username: username != null ? String(username) : undefined,
    body: r.body != null ? String(r.body) : undefined,
    tags,
    starred: typeof r.starred === "boolean" ? r.starred : undefined,
    archived: typeof r.archived === "boolean" ? r.archived : undefined,
    scope,
    groupSlug:
      typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : undefined,
    updatedAt:
      r.updatedAt != null
        ? String(r.updatedAt)
        : r.updated_at != null
          ? String(r.updated_at)
          : undefined,
    contentUpdatedAt:
      r.contentUpdatedAt != null
        ? String(r.contentUpdatedAt)
        : r.content_updated_at != null
          ? String(r.content_updated_at)
          : undefined,
    ...(r.hasShares === true ? { hasShares: true } : {}),
    ...(r.hasPublicShare === true ? { hasPublicShare: true } : {}),
    ...(r.hasTeamShare === true ? { hasTeamShare: true } : {}),
  };
}

export function parseNotesItemsPayload(json: unknown): WgwNoteItem[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  let raw: unknown = o.items ?? o.notes ?? o.data;
  if (!Array.isArray(raw) && raw && typeof raw === "object") {
    const inner = raw as Record<string, unknown>;
    if (Array.isArray(inner.items)) raw = inner.items;
    else if (Array.isArray(inner.notes)) raw = inner.notes;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceNoteItem).filter(Boolean) as WgwNoteItem[];
}

export type NotesNotebookRow = {
  name: string;
  scope?: "personal" | "group";
  groupSlug?: string | null;
  /** Owner outgoing shares on this personal notebook directory. */
  hasShares?: boolean;
};

export type NotesSharedNoteListRights = {
  mayEditContent: boolean;
};

export type NotesSharedNoteEntry = {
  path: string;
  id: string;
  notebook: string;
  title: string;
  /** Frontmatter tags from the shared `.md` (same source of truth as owned notes). */
  tags: string[];
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
  /** From list API `myRights` (or derived from `access` when rights are omitted). */
  myRights?: NotesSharedNoteListRights;
};

export type NotesSharedNotebookEntry = {
  path: string;
  notebook: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
  myRights?: NotesSharedNoteListRights;
};

export function coerceNotebookRow(raw: unknown): NotesNotebookRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = r.name ?? r.title ?? r.notebook;
  if (name == null) return null;
  const scope = r.scope === "group" ? "group" : r.scope === "personal" ? "personal" : undefined;
  return {
    name: String(name),
    scope,
    groupSlug:
      typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : undefined,
    ...(r.hasShares === true ? { hasShares: true } : {}),
  };
}

export function parseNotebookRowsPayload(json: unknown): NotesNotebookRow[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.notebooks ?? o.data;
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceNotebookRow).filter((x): x is NotesNotebookRow => x !== null);
}

/** Personal notebook names only (legacy string list for bootstrap / offline). */
export function parseNotebooksPayload(json: unknown): string[] {
  return parseNotebookRowsPayload(json)
    .filter((row) => row.scope !== "group")
    .map((row) => row.name);
}

function normalizeNotesPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Prefer explicit list `myRights.mayEditContent`; fall back to share `access`
 * so view-only rows still badge when rights are omitted from a payload.
 */
export function resolveSharedNoteMayEditContent(entry: {
  access?: string;
  myRights?: NotesSharedNoteListRights | { mayEditContent?: unknown };
}): boolean | undefined {
  const fromRights = entry.myRights?.mayEditContent;
  if (typeof fromRights === "boolean") return fromRights;
  if (entry.access === "view" || entry.access === "comment") return false;
  if (entry.access === "edit" || entry.access === "full" || entry.access === "review") return true;
  return undefined;
}

function coerceSharedListRights(
  raw: unknown,
  access?: string,
): NotesSharedNoteListRights | undefined {
  const mayEditContent = resolveSharedNoteMayEditContent({
    access,
    myRights: raw && typeof raw === "object" ? (raw as { mayEditContent?: unknown }) : undefined,
  });
  return mayEditContent === undefined ? undefined : { mayEditContent };
}

function noteMyRightsFromSharedEntry(
  entry: Pick<NotesSharedNoteEntry, "access" | "myRights">,
): Note["myRights"] | undefined {
  const mayEditContent = resolveSharedNoteMayEditContent(entry);
  return mayEditContent === undefined ? undefined : { mayEditContent };
}

export function coerceSharedNoteEntry(raw: unknown): NotesSharedNoteEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? normalizeNotesPath(r.path) : "";
  const id = r.id;
  const notebook = r.notebook;
  if (!path || id == null || notebook == null) return null;
  const scope = r.scope === "group" ? "group" : "personal";
  const tagsRaw = r.tags;
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => String(t)).filter(Boolean) : [];
  const access = typeof r.access === "string" ? r.access : undefined;
  const myRights = coerceSharedListRights(r.myRights, access);
  return {
    path,
    id: String(id),
    notebook: String(notebook),
    title: r.title != null ? String(r.title) : String(id),
    tags,
    owner: r.owner != null ? String(r.owner) : "",
    scope,
    groupSlug: typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : null,
    access,
    ...(myRights ? { myRights } : {}),
  };
}

export function coerceSharedNotebookEntry(raw: unknown): NotesSharedNotebookEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? normalizeNotesPath(r.path) : "";
  const notebook = r.notebook;
  if (!path || notebook == null) return null;
  const scope = r.scope === "group" ? "group" : "personal";
  const access = typeof r.access === "string" ? r.access : undefined;
  const myRights = coerceSharedListRights(r.myRights, access);
  return {
    path,
    notebook: String(notebook),
    owner: r.owner != null ? String(r.owner) : "",
    scope,
    groupSlug: typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : null,
    access,
    ...(myRights ? { myRights } : {}),
  };
}

export function parseSharedNotesPayload(json: unknown): NotesSharedNoteEntry[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.data;
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceSharedNoteEntry).filter((x): x is NotesSharedNoteEntry => x !== null);
}

export type NotesSharedNotebooksPayload = {
  items: NotesSharedNotebookEntry[];
  /** Notes under ACL-shared notebook dirs (from `notes` on the same response). */
  notes: NotesSharedNoteEntry[];
};

export function parseSharedNotebooksPayload(json: unknown): NotesSharedNotebooksPayload {
  if (!json || typeof json !== "object") {
    return { items: [], notes: [] };
  }
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.data;
  const items = Array.isArray(raw)
    ? raw.map(coerceSharedNotebookEntry).filter((x): x is NotesSharedNotebookEntry => x !== null)
    : [];
  const notesRaw = o.notes;
  const notes = Array.isArray(notesRaw)
    ? notesRaw.map(coerceSharedNoteEntry).filter((x): x is NotesSharedNoteEntry => x !== null)
    : [];
  return { items, notes };
}

export function noteEntryFromDriveSharedPath(args: {
  path: string;
  access?: string;
  myRights?: NotesSharedNoteListRights | { mayEditContent?: unknown };
  title?: string;
  tags?: string[];
}): NotesSharedNoteEntry | null {
  const parsed = parseNoteVirtualPath(args.path);
  if (!parsed) return null;
  const access = args.access;
  const myRights = coerceSharedListRights(args.myRights, access);
  return {
    path: parsed.path,
    id: parsed.noteId,
    notebook: parsed.notebook,
    title: args.title ?? "",
    tags: args.tags ?? [],
    owner: parsed.owner,
    scope: parsed.scope,
    groupSlug: parsed.groupSlug,
    access,
    ...(myRights ? { myRights } : {}),
  };
}

/** List note-file grants via Drive `GET /files/shared-with-me?includeNotes=true`. */
export async function fetchNotesSharedWithMe(opts?: {
  signal?: AbortSignal;
}): Promise<NotesSharedNoteEntry[]> {
  const rows = await fetchDriveSharedWithMe({ signal: opts?.signal, includeNotes: true });
  const mapped = rows
    .map((row) =>
      noteEntryFromDriveSharedPath({
        path: row.share.path,
        access: row.share.defaultAccess,
        myRights: row.share.myRights,
      }),
    )
    .filter((entry): entry is NotesSharedNoteEntry => entry !== null);

  return Promise.all(
    mapped.map(async (entry) => {
      const projection = await fileNodeNoteProjectionAtPath(entry.path, opts);
      if (!projection) return entry;
      return {
        ...entry,
        title:
          usableNoteListPreview(projection.excerpt, entry.id) ||
          usableNoteListPreview(projection.title, entry.id) ||
          usableNoteListPreview(entry.title, entry.id),
        tags: projection.tags,
      };
    }),
  );
}

/** Group-membership notebooks from FileNode listing (personal ACL notebook shares are gone). */
export async function fetchNotesSharedNotebooks(opts?: {
  signal?: AbortSignal;
}): Promise<NotesSharedNotebooksPayload> {
  const listing = await listOwnedNotesFromFileNodes(opts);
  return { items: listing.sharedNotebooks, notes: [] };
}

/** Path-stable list id when a shared grant collides with an owned (or sibling) note id. */
export function sharedInboxFallbackId(path: string): string {
  const normalized = normalizeNotesPath(path).replace(/^\//, "");
  return `swm:${normalized}`;
}

/**
 * Shared-list `title` is a body-first preview — never fall back to the note id.
 * Empty / id-equal titles leave body blank so list rows show “Untitled note”
 * (and collab IDB enrich can still fill a real preview without selecting).
 */
export function sharedEntryListPreview(entry: Pick<NotesSharedNoteEntry, "id" | "title">): string {
  return usableNoteListPreview(entry.title, entry.id);
}

export function noteFromSharedEntry(entry: NotesSharedNoteEntry): Note {
  const title = sharedEntryListPreview(entry);
  const sharedBy = entry.owner.trim();
  const myRights = noteMyRightsFromSharedEntry(entry);
  return {
    id: entry.id,
    notebook: entry.notebook,
    excerpt: title,
    body: title ? [title] : [""],
    // Personal Shared-with-me recipients never see tags — omit from the stub.
    tags: [],
    wordCount: wordCountFromText(title),
    category: "Note",
    date: "—",
    scope: entry.scope,
    groupSlug: entry.groupSlug,
    apiPath: entry.path,
    sharedInbox: true,
    ...(sharedBy ? { sharedBy } : {}),
    ...(myRights ? { myRights } : {}),
  };
}

/**
 * Merge Shared-with-me file grants into the owned note list.
 *
 * Do **not** drop grants that collide on note id with an owned row: offline
 * `local-*` ids can leak across accounts, and the same id can appear under
 * different owners/notebooks. When ids collide, keep both rows and give the
 * inbox stub a path-stable id so list keys / Shared-with-me filtering work.
 * Collab/share still use {@link Note.apiPath}.
 */
export function mergeOwnedAndSharedInboxNotes(
  ownedNotes: Note[],
  sharedWithMe: NotesSharedNoteEntry[],
): Note[] {
  const usedIds = new Set(ownedNotes.map((note) => note.id));
  const inboxNotes: Note[] = [];
  for (const entry of sharedWithMe) {
    const note = noteFromSharedEntry(entry);
    if (usedIds.has(note.id)) {
      note.id = sharedInboxFallbackId(entry.path);
    }
    usedIds.add(note.id);
    inboxNotes.push(note);
  }
  return [...ownedNotes, ...inboxNotes];
}

function sharedNotebookFromGroupRow(row: NotesNotebookRow): NotesSharedNotebookEntry | null {
  if (row.scope !== "group" || !row.groupSlug?.trim()) return null;
  const slug = row.groupSlug.trim();
  return {
    path: normalizeNotesPath(`/groups/${slug}/.notes/${row.name}`),
    notebook: row.name,
    owner: slug,
    scope: "group",
    groupSlug: slug,
  };
}

/** Group-membership notebooks only (personal ACL notebook shares are not a product feature). */
function mergeGroupSharedNotebooks(groupRows: NotesNotebookRow[]): NotesSharedNotebookEntry[] {
  const byPath = new Map<string, NotesSharedNotebookEntry>();
  for (const row of groupRows) {
    const entry = sharedNotebookFromGroupRow(row);
    if (!entry) continue;
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => a.notebook.localeCompare(b.notebook));
}

// --- WGW note shapes → app `Note` + request helpers ----------------------------------------------

function wordCountFromText(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function splitBodyParagraphs(body: string): string[] {
  const t = body.trim();
  if (!t) return [""];
  const parts = t
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

function excerptFromBody(body: string, max = 180): string {
  // Strip markdown so list titles/previews match enrichNote / noteListTitle.
  const text = markdownToPlainText(body);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function noteFromWgwItem(row: WgwNoteItem): Note {
  const body = splitBodyParagraphs(row.body ?? "");
  const flat = body.join("\n\n");
  const metadataUpdatedAt = row.updatedAt;
  // Prefer content mtime for display so body-only collab saves show as “Edited”.
  // Keep metadataUpdatedAt on the note for offline ifInState guards.
  const displayDate = row.contentUpdatedAt ?? metadataUpdatedAt ?? "—";
  const excerpt = excerptFromBody(row.body ?? "");
  return {
    id: row.id,
    notebook: row.notebook,
    excerpt,
    body,
    tags: row.tags ?? [],
    wordCount: wordCountFromText(flat),
    category: "Note",
    date: displayDate,
    ...(metadataUpdatedAt !== undefined ? { updatedAt: metadataUpdatedAt } : {}),
    starred: row.starred,
    archived: row.archived,
    ...(row.scope !== undefined ? { scope: row.scope } : {}),
    ...(row.groupSlug !== undefined ? { groupSlug: row.groupSlug } : {}),
    ...(row.hasShares === true || row.hasPublicShare === true || row.hasTeamShare === true
      ? { isShared: true }
      : {}),
  };
}

/**
 * Full upsert shape (incl. `body`) for creating a note.
 * Live writes send title/tags via REST PATCH; `body` stays collab-owned.
 */
export function wgwNoteUpsertFromNote(
  note: Note,
  opts?: { starred?: boolean; archived?: boolean },
): WgwNoteUpsertRequest {
  return {
    id: note.id,
    notebook: note.notebook,
    body: note.body.join("\n\n"),
    tags: note.tags,
    ...(opts?.starred !== undefined && { starred: opts.starred }),
    ...(opts?.archived !== undefined && { archived: opts.archived }),
    ...(note.scope === "group" && note.groupSlug?.trim()
      ? { groupSlug: note.groupSlug.trim() }
      : {}),
  };
}

/**
 * Metadata-only upsert (no `body`) for REST title/tags/moves.
 * `starred` is consumed by `POST|DELETE /notes/items/{id}/star`.
 * Body edits stay on `PATCH /notes/items/{id}` from the collab session.
 */
export function wgwNoteMetadataFromNote(
  note: Note,
  opts?: { starred?: boolean; archived?: boolean },
): WgwNoteUpsertRequest {
  return {
    id: note.id,
    notebook: note.notebook,
    ...(note.title !== undefined ? { title: note.title } : {}),
    tags: note.tags,
    ...(opts?.starred !== undefined && { starred: opts.starred }),
    ...(opts?.archived !== undefined && { archived: opts.archived }),
    ...(note.scope === "group" && note.groupSlug?.trim()
      ? { groupSlug: note.groupSlug.trim() }
      : {}),
    ...(note.etag ? { etag: note.etag } : {}),
  };
}

// --- live bootstrap ----------------------------------------------------------------------------

/** Load notes + notebooks from CalDAV VJOURNAL REST. */
export async function fetchNotesLiveBootstrap(): Promise<NotesAppBootstrap> {
  return fetchNotesVjournalBootstrap();
}

async function notebooksForMap() {
  return listNotebooks();
}

async function ifMatchForNote(
  id: string,
  preferred: string | undefined,
  opts?: { signal?: AbortSignal },
): Promise<string | undefined> {
  if (preferred) return preferred;
  try {
    return (await getNote(id, opts)).etag;
  } catch {
    return undefined;
  }
}

export async function createNoteItem(
  body: WgwNoteUpsertRequest,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const notebook = notebooks.find(
    (item) => item.name === body.notebook && (body.groupSlug ? item.groupSlug === body.groupSlug : true),
  );
  if (!notebook) {
    throw new NotesRequestError("Notebook not found", 404);
  }
  const created = await createVjournalNote(
    {
      notebookId: notebook.id,
      title: null,
      body: body.body ?? "",
      categories: body.tags ?? [],
      status: body.archived ? "CANCELLED" : null,
      uid: body.id,
    },
    opts,
  );
  if (body.starred) {
    await starNote(created.id, opts);
    created.starred = true;
  }
  return noteFromVjournal(created, notebooks);
}

export async function updateNoteItem(
  id: string,
  body: WgwNoteUpsertRequest,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const notebook = notebooks.find((item) => item.name === body.notebook);
  const ifMatch = await ifMatchForNote(id, body.etag, opts);
  const patched = await patchNote(
    id,
    {
      ...(notebook ? { notebookId: notebook.id } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      categories: body.tags,
      status: body.archived ? "CANCELLED" : "FINAL",
    },
    { ...opts, ifMatch },
  );
  if (body.starred === true) await starNote(id, opts);
  if (body.starred === false) await unstarNote(id, opts);
  return noteFromVjournal({ ...patched, starred: body.starred ?? patched.starred }, notebooks);
}

export async function deleteNoteItem(
  id: string,
  _body: { notebook: string; archived: boolean; groupSlug?: string | null },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await deleteVjournalNote(id, opts);
}

export async function archiveNoteItem(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const ifMatch = await ifMatchForNote(id, undefined, opts);
  const patched = await patchNote(id, { status: "CANCELLED" }, { ...opts, ifMatch });
  return noteFromVjournal(patched, notebooks);
}

export async function restoreNoteItem(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const ifMatch = await ifMatchForNote(id, undefined, opts);
  const patched = await patchNote(id, { status: "FINAL" }, { ...opts, ifMatch });
  return noteFromVjournal(patched, notebooks);
}

export async function createNotebook(
  name: string,
  opts?: { signal?: AbortSignal; color?: string | null; groupSlug?: string | null },
): Promise<NotesVjournalNotebook> {
  return createVjournalNotebook(
    {
      name,
      ...(opts?.color?.trim() ? { color: opts.color.trim() } : {}),
      ...(opts?.groupSlug?.trim() ? { groupSlug: opts.groupSlug.trim() } : {}),
    },
    opts,
  );
}

export async function patchNotebookCollection(
  notebookId: string,
  patch: {
    name?: string;
    color?: string | null;
    groupSlug?: string | null;
    shareWith?: Parameters<typeof patchNotebook>[1]["shareWith"];
  },
  opts?: { signal?: AbortSignal },
) {
  return patchNotebook(notebookId, patch, opts);
}

export async function renameNotebook(
  from: string,
  to: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const notebooks = await notebooksForMap();
  const notebook = notebooks.find((item) => item.name === from);
  if (!notebook) throw new NotesRequestError("Notebook not found", 404);
  await patchNotebook(notebook.id, { name: to }, opts);
}

export async function deleteNotebook(
  name: string,
  action: { mode: "archive" | "move" | "purge"; target?: string },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const notebooks = await notebooksForMap();
  const notebook = notebooks.find((item) => item.name === name);
  if (!notebook) throw new NotesRequestError("Notebook not found", 404);
  if (action.mode === "move" && action.target) {
    const dest = notebooks.find((item) => item.name === action.target);
    if (!dest) throw new NotesRequestError("Target notebook not found", 404);
    const { listNotes } = await import("@/lib/api/wgw/notes-vjournal");
    const items = await listNotes({ notebookId: notebook.id, signal: opts?.signal });
    for (const item of items) {
      await patchNote(item.id, { notebookId: dest.id }, { ...opts, ifMatch: item.etag });
    }
  }
  await deleteVjournalNotebook(notebook.id, {
    ...opts,
    onDestroyRemoveContents: action.mode === "purge" || action.mode === "archive",
  });
}
