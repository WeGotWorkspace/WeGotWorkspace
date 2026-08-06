import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import type { WgwNoteItem, WgwNoteUpsertRequest } from "@/lib/api/wgw/types";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";

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
};

export type NotesSharedNoteEntry = {
  path: string;
  id: string;
  notebook: string;
  title: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
};

export type NotesSharedNotebookEntry = {
  path: string;
  notebook: string;
  owner: string;
  scope: "personal" | "group";
  groupSlug: string | null;
  access?: string;
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

export function coerceSharedNoteEntry(raw: unknown): NotesSharedNoteEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? normalizeNotesPath(r.path) : "";
  const id = r.id;
  const notebook = r.notebook;
  if (!path || id == null || notebook == null) return null;
  const scope = r.scope === "group" ? "group" : "personal";
  return {
    path,
    id: String(id),
    notebook: String(notebook),
    title: r.title != null ? String(r.title) : String(id),
    owner: r.owner != null ? String(r.owner) : "",
    scope,
    groupSlug: typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : null,
    access: typeof r.access === "string" ? r.access : undefined,
  };
}

export function coerceSharedNotebookEntry(raw: unknown): NotesSharedNotebookEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? normalizeNotesPath(r.path) : "";
  const notebook = r.notebook;
  if (!path || notebook == null) return null;
  const scope = r.scope === "group" ? "group" : "personal";
  return {
    path,
    notebook: String(notebook),
    owner: r.owner != null ? String(r.owner) : "",
    scope,
    groupSlug: typeof r.groupSlug === "string" ? r.groupSlug : r.groupSlug === null ? null : null,
    access: typeof r.access === "string" ? r.access : undefined,
  };
}

export function parseSharedNotesPayload(json: unknown): NotesSharedNoteEntry[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.data;
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceSharedNoteEntry).filter((x): x is NotesSharedNoteEntry => x !== null);
}

export function parseSharedNotebooksPayload(json: unknown): NotesSharedNotebookEntry[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.data;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(coerceSharedNotebookEntry)
    .filter((x): x is NotesSharedNotebookEntry => x !== null);
}

/** List note-file grants under `.notes` (Shared with me). */
export async function fetchNotesSharedWithMe(opts?: {
  signal?: AbortSignal;
}): Promise<NotesSharedNoteEntry[]> {
  const res = await wgwFetch("/notes/shared-with-me", { signal: opts?.signal });
  if (!res.ok)
    throw new NotesRequestError(`GET /notes/shared-with-me failed (${res.status})`, res.status);
  return parseSharedNotesPayload(await wgwReadJson(res));
}

/** List notebook-dir grants under `.notes` (Shared notebooks ACL rows). */
export async function fetchNotesSharedNotebooks(opts?: {
  signal?: AbortSignal;
}): Promise<NotesSharedNotebookEntry[]> {
  const res = await wgwFetch("/notes/shared-notebooks", { signal: opts?.signal });
  if (!res.ok) {
    throw new NotesRequestError(`GET /notes/shared-notebooks failed (${res.status})`, res.status);
  }
  return parseSharedNotebooksPayload(await wgwReadJson(res));
}

/** Path-stable list id when a shared grant collides with an owned (or sibling) note id. */
export function sharedInboxFallbackId(path: string): string {
  const normalized = normalizeNotesPath(path).replace(/^\//, "");
  return `swm:${normalized}`;
}

export function noteFromSharedEntry(entry: NotesSharedNoteEntry): Note {
  const title = entry.title.trim() || entry.id;
  return {
    id: entry.id,
    notebook: entry.notebook,
    excerpt: title,
    body: [title],
    tags: [],
    wordCount: wordCountFromText(title),
    category: "Note",
    date: "—",
    scope: entry.scope,
    groupSlug: entry.groupSlug,
    apiPath: entry.path,
    sharedInbox: true,
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

function mergeSharedNotebooks(
  acl: NotesSharedNotebookEntry[],
  groupRows: NotesNotebookRow[],
): NotesSharedNotebookEntry[] {
  const byPath = new Map<string, NotesSharedNotebookEntry>();
  for (const entry of acl) {
    byPath.set(entry.path, entry);
  }
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
  };
}

/** Full upsert (incl. `body`) — use only for **creating** a note (`POST /notes/items`). */
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
  };
}

/**
 * Metadata-only upsert (no `body`) for `PUT /notes/items/{id}`. The API leaves
 * the markdown body untouched on disk — body edits flow through the collab
 * document (`PUT /files/collaboration`), not the Notes metadata API.
 */
export function wgwNoteMetadataFromNote(
  note: Note,
  opts?: { starred?: boolean; archived?: boolean },
): WgwNoteUpsertRequest {
  return {
    id: note.id,
    notebook: note.notebook,
    tags: note.tags,
    ...(opts?.starred !== undefined && { starred: opts.starred }),
    ...(opts?.archived !== undefined && { archived: opts.archived }),
  };
}

// --- live bootstrap ----------------------------------------------------------------------------

/** Load notes + notebook names from the configured WeGotWorkspace API. */
export async function fetchNotesLiveBootstrap(): Promise<NotesAppBootstrap> {
  const session = await wgwFetchPrincipal();

  const itemsRes = await wgwFetch("/notes/items");
  if (!itemsRes.ok) throw new Error(`GET /notes/items failed (${itemsRes.status})`);
  const itemsJson = await wgwReadJson(itemsRes);
  const rawItems = parseNotesItemsPayload(itemsJson);
  const ownedNotes = rawItems.map(noteFromWgwItem);

  let notebookRows: NotesNotebookRow[] = [];
  const nbRes = await wgwFetch("/notes/notebooks");
  if (nbRes.ok) {
    const nbJson = await wgwReadJson(nbRes);
    notebookRows = parseNotebookRowsPayload(nbJson);
  }

  let sharedWithMe: NotesSharedNoteEntry[] = [];
  let aclSharedNotebooks: NotesSharedNotebookEntry[] = [];
  try {
    const [swm, sharedNbs] = await Promise.all([
      fetchNotesSharedWithMe(),
      fetchNotesSharedNotebooks(),
    ]);
    sharedWithMe = swm;
    aclSharedNotebooks = sharedNbs;
  } catch {
    // Shared listings are best-effort — owned notes still load if these fail.
  }

  const notes = mergeOwnedAndSharedInboxNotes(ownedNotes, sharedWithMe);

  const personalFromApi = notebookRows
    .filter((row) => row.scope !== "group")
    .map((row) => row.name);
  const personalFromNotes = ownedNotes.filter((n) => n.scope !== "group").map((n) => n.notebook);
  const notebooks = [...new Set([...personalFromApi, ...personalFromNotes])].filter((name) =>
    name.trim(),
  );

  const groupRowsFromNotes = ownedNotes
    .filter((n) => n.scope === "group" && n.groupSlug?.trim())
    .map(
      (n): NotesNotebookRow => ({
        name: n.notebook,
        scope: "group",
        groupSlug: n.groupSlug ?? null,
      }),
    );
  const sharedNotebooks = mergeSharedNotebooks(aclSharedNotebooks, [
    ...notebookRows,
    ...groupRowsFromNotes,
  ]);

  const tags = [...new Set(ownedNotes.flatMap((n) => n.tags))];

  return {
    data: { notes, notebooks, tags, sharedNotebooks },
    session,
  };
}

function parseNoteMutationPayload(json: unknown): WgwNoteItem | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  return coerceNoteItem(root.item ?? root.note ?? root.data ?? root);
}

async function requestNotesJson(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  opts?: { signal?: AbortSignal },
): Promise<unknown> {
  const res = await wgwFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) throw new NotesRequestError(`${method} ${path} failed (${res.status})`, res.status);
  return wgwReadJson(res);
}

export async function createNoteItem(
  body: WgwNoteUpsertRequest,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const json = await requestNotesJson("/notes/items", "POST", body, opts);
  const row = parseNoteMutationPayload(json);
  if (!row) throw new Error("POST /notes/items returned no note payload");
  return noteFromWgwItem(row);
}

export async function updateNoteItem(
  id: string,
  body: WgwNoteUpsertRequest,
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const json = await requestNotesJson(`/notes/items/${encodeURIComponent(id)}`, "PUT", body, opts);
  const row = parseNoteMutationPayload(json);
  if (!row) throw new Error(`PUT /notes/items/${id} returned no note payload`);
  return noteFromWgwItem(row);
}

export async function deleteNoteItem(
  id: string,
  body: { notebook: string; archived: boolean },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await requestNotesJson(`/notes/items/${encodeURIComponent(id)}`, "DELETE", body, opts);
}

export async function archiveNoteItem(id: string, opts?: { signal?: AbortSignal }): Promise<Note> {
  const json = await requestNotesJson(
    `/notes/items/${encodeURIComponent(id)}`,
    "PATCH",
    { archived: true },
    opts,
  );
  const row = parseNoteMutationPayload(json);
  if (!row) throw new Error(`PATCH /notes/items/${id} archive returned no note payload`);
  return noteFromWgwItem(row);
}

export async function restoreNoteItem(id: string, opts?: { signal?: AbortSignal }): Promise<Note> {
  const json = await requestNotesJson(
    `/notes/items/${encodeURIComponent(id)}`,
    "PATCH",
    { archived: false },
    opts,
  );
  const row = parseNoteMutationPayload(json);
  if (!row) throw new Error(`PATCH /notes/items/${id} restore returned no note payload`);
  return noteFromWgwItem(row);
}

export async function createNotebook(name: string, opts?: { signal?: AbortSignal }): Promise<void> {
  await requestNotesJson("/notes/notebooks", "POST", { name }, opts);
}

export async function renameNotebook(
  from: string,
  to: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await requestNotesJson(
    `/notes/notebooks/${encodeURIComponent(from)}`,
    "PATCH",
    { name: to },
    opts,
  );
}

export async function deleteNotebook(
  name: string,
  action: { mode: "archive" | "move" | "purge"; target?: string },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await requestNotesJson(`/notes/notebooks/${encodeURIComponent(name)}`, "DELETE", action, opts);
}
