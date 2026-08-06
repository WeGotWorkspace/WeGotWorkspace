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

export function coerceNotebookRow(raw: unknown): { name: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = r.name ?? r.title ?? r.notebook;
  if (name == null) return null;
  return { name: String(name) };
}

export function parseNotebooksPayload(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const raw = o.items ?? o.notebooks ?? o.data;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(coerceNotebookRow)
    .filter((x): x is { name: string } => x !== null)
    .map((x) => x.name);
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
  const notes = rawItems.map(noteFromWgwItem);

  let notebookNames: string[] = [];
  const nbRes = await wgwFetch("/notes/notebooks");
  if (nbRes.ok) {
    const nbJson = await wgwReadJson(nbRes);
    notebookNames = parseNotebooksPayload(nbJson);
  }

  const fromNotes = [...new Set(notes.map((n) => n.notebook))];
  const notebooks = [...new Set([...notebookNames, ...fromNotes])];
  const tags = [...new Set(notes.flatMap((n) => n.tags))];

  return {
    data: { notes, notebooks, tags },
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
