import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { DeleteNotebookAction } from "@/notes-core/src/notes-types";
import type { Note } from "@/lib/models/note";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import type { WgwNoteItem, WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
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
  type NotesVjournalNote,
  type NotesVjournalNotebook,
} from "@/lib/api/wgw/notes-vjournal";

export class NotesRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
  /** Owner outgoing notebook shares. */
  hasShares?: boolean;
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
    ...(note.title !== undefined ? { title: note.title } : {}),
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
 * Metadata-only upsert (no `body`). A PATCH includes only the fields the
 * action means to change. `tags` is an explicit categories replace; omit it
 * for archive, star, and notebook move so a cached set cannot overwrite the
 * server. `title` is the same for SUMMARY. Create uses `wgwNoteUpsertFromNote`.
 * `starred` is consumed by `POST|DELETE /notes/items/{id}/star`.
 */
export function wgwNoteMetadataFromNote(
  note: Note,
  opts?: {
    starred?: boolean;
    archived?: boolean;
    includeTitle?: boolean;
    includeTags?: boolean;
  },
): WgwNoteUpsertRequest {
  return {
    id: note.id,
    notebook: note.notebook,
    ...(note.notebookId ? { notebookId: note.notebookId } : {}),
    ...(opts?.includeTitle && note.title !== undefined ? { title: note.title } : {}),
    ...(opts?.includeTags ? { tags: note.tags } : {}),
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
    (item) =>
      item.name === body.notebook && (body.groupSlug ? item.groupSlug === body.groupSlug : true),
  );
  if (!notebook) {
    throw new NotesRequestError("Notebook not found", 404);
  }
  const created = await createVjournalNote(
    {
      notebookId: notebook.id,
      title: body.title !== undefined ? body.title : null,
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

type NoteMetadataPatch = {
  notebookId?: string;
  title?: string | null;
  categories?: string[];
  categoriesAdd?: string[];
  categoriesRemove?: string[];
};

function tagDeltaPatch(body: WgwNoteUpsertRequest): NoteMetadataPatch | undefined {
  if (body.tagsAdd === undefined && body.tagsRemove === undefined) return undefined;
  return {
    ...(body.tagsAdd !== undefined ? { categoriesAdd: body.tagsAdd } : {}),
    ...(body.tagsRemove !== undefined ? { categoriesRemove: body.tagsRemove } : {}),
  };
}

function noteMetadataPatch(
  body: WgwNoteUpsertRequest,
  notebookId: string | undefined,
): NoteMetadataPatch {
  const delta = tagDeltaPatch(body);
  return {
    ...(notebookId ? { notebookId } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    // Categories stay off the wire unless this write carried tags. Archive
    // STATUS is never part of this patch: a stale archived:false was PATCHing
    // FINAL and un-archiving the note. A delta omits categories; the server
    // applies it to the stored set.
    ...(delta ?? (body.tags !== undefined ? { categories: body.tags } : {})),
  };
}

/** Server order first, then local tags the server does not have yet. */
function unionNoteTags(serverTags: readonly string[], localTags: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...serverTags, ...localTags]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    merged.push(tag);
  }
  return merged;
}

function isTagDeltaPatch(patch: NoteMetadataPatch): boolean {
  return patch.categoriesAdd !== undefined || patch.categoriesRemove !== undefined;
}

function noteMetadataPatchAfterConflict(
  first: NoteMetadataPatch,
  fresh: NotesVjournalNote,
  localTags: readonly string[] | undefined,
): NoteMetadataPatch {
  const notebookStillMatches =
    first.notebookId !== undefined && fresh.notebookId === first.notebookId;
  if (isTagDeltaPatch(first)) {
    return {
      ...(notebookStillMatches ? { notebookId: first.notebookId } : {}),
      ...(first.title !== undefined ? { title: first.title } : {}),
      ...(first.categoriesAdd !== undefined ? { categoriesAdd: first.categoriesAdd } : {}),
      ...(first.categoriesRemove !== undefined ? { categoriesRemove: first.categoriesRemove } : {}),
    };
  }
  return {
    ...(notebookStillMatches ? { notebookId: first.notebookId } : {}),
    ...(first.title !== undefined ? { title: first.title } : {}),
    ...(first.categories !== undefined
      ? { categories: unionNoteTags(fresh.categories, localTags ?? []) }
      : {}),
  };
}

export async function updateNoteItem(
  id: string,
  body: WgwNoteUpsertRequest,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const notebook =
    (body.notebookId ? notebooks.find((item) => item.id === body.notebookId) : undefined) ??
    notebooks.find((item) => item.name === body.notebook);
  const firstPatch = noteMetadataPatch(body, notebook?.id);
  const apply = async (ifMatch: string | undefined, patch: NoteMetadataPatch) =>
    patchNote(id, patch, { ...opts, ifMatch });
  const ifMatch = await ifMatchForNote(id, body.etag, opts);
  let patched;
  try {
    patched = await apply(ifMatch, firstPatch);
  } catch (error) {
    if (!isNotePreconditionFailed(error)) throw error;
    // Someone else wrote first. A tag delta is applied on the server to
    // whatever is stored, so the retry sends that same delta. A full tag
    // list still unions with the fresh set. A different notebook means they
    // moved it, so this retry leaves that move.
    const fresh = await getNote(id, opts);
    patched = await apply(fresh.etag, noteMetadataPatchAfterConflict(firstPatch, fresh, body.tags));
  }
  if (body.starred === true) await starNote(id, opts);
  if (body.starred === false) await unstarNote(id, opts);
  return noteFromVjournal({ ...patched, starred: body.starred ?? patched.starred }, notebooks);
}

export async function deleteNoteItem(
  id: string,
  body: { notebook: string; archived: boolean; groupSlug?: string | null; etag?: string },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const apply = async (ifMatch: string | undefined) => deleteVjournalNote(id, { ...opts, ifMatch });
  const ifMatch = await ifMatchForNote(id, body.etag, opts);
  try {
    await apply(ifMatch);
  } catch (error) {
    if (!isNotePreconditionFailed(error)) throw error;
    await apply(await ifMatchForNote(id, undefined, opts));
  }
}

function isNotePreconditionFailed(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 412;
}

async function patchNoteArchiveStatus(
  id: string,
  status: "CANCELLED" | "FINAL",
  opts?: { signal?: AbortSignal; groupSlug?: string | null; ifMatch?: string },
): Promise<Note> {
  const notebooks = await notebooksForMap();
  const apply = async (ifMatch: string | undefined) => {
    const patched = await patchNote(id, { status }, { ...opts, ifMatch });
    return noteFromVjournal(patched, notebooks);
  };
  const ifMatch = await ifMatchForNote(id, opts?.ifMatch, opts);
  try {
    return await apply(ifMatch);
  } catch (error) {
    if (!isNotePreconditionFailed(error)) throw error;
    const retryMatch = await ifMatchForNote(id, undefined, opts);
    return await apply(retryMatch);
  }
}

export async function archiveNoteItem(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null; ifMatch?: string },
): Promise<Note> {
  return patchNoteArchiveStatus(id, "CANCELLED", opts);
}

export async function restoreNoteItem(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null; ifMatch?: string },
): Promise<Note> {
  return patchNoteArchiveStatus(id, "FINAL", opts);
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

function notebookByIdOrName<T extends { id: string; name: string }>(
  notebooks: readonly T[],
  idOrName: string,
): T | undefined {
  return (
    notebooks.find((item) => item.id === idOrName) ??
    notebooks.find((item) => item.name === idOrName)
  );
}

export async function deleteNotebook(
  notebookIdOrName: string,
  action: DeleteNotebookAction,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const notebooks = await notebooksForMap();
  const notebook = notebookByIdOrName(notebooks, notebookIdOrName);
  if (!notebook) throw new NotesRequestError("Notebook not found", 404);
  if (action.kind === "move") {
    const dest = notebookByIdOrName(notebooks, action.target);
    if (!dest) throw new NotesRequestError("Target notebook not found", 404);
    await deleteVjournalNotebook(notebook.id, { ...opts, moveNotesTo: dest.id });
    return;
  }
  await deleteVjournalNotebook(notebook.id, {
    ...opts,
    ...(action.kind === "purge" ? { onDestroyRemoveContents: true } : {}),
  });
}
