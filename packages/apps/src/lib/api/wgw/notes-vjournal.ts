import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import { mapTaskProjectGroups } from "@/lib/api/wgw/tasks";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { autofillNoteTitle } from "@/notes-core/src/notes-title-autofill";

export class NotesVjournalRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isNotesCannotCalculateChanges(error: unknown): boolean {
  return error instanceof NotesVjournalRequestError && error.code === "cannotCalculateChanges";
}

export function isNotesNotFound(error: unknown): boolean {
  return (
    error instanceof NotesVjournalRequestError &&
    (error.status === 404 || error.code === "not_found")
  );
}

export type NotesVjournalNotebook = NotesNotebookCollection & {
  id: string;
  name: string;
};

export type NotesVjournalNote = {
  id: string;
  notebookId: string;
  title: string | null;
  body: string;
  categories: string[];
  status: "FINAL" | "CANCELLED" | null;
  etag: string;
  starred?: boolean;
  /** LAST-MODIFIED, else DTSTAMP, else calendarobjects.lastmodified. */
  updatedAt?: string;
  /** Optional content mtime when the API projects it (collab body saves). */
  contentUpdatedAt?: string;
};

type NotesRequestOpts = {
  signal?: AbortSignal;
  ifMatch?: string;
};

async function requestNotesJson(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  opts?: NotesRequestOpts,
): Promise<unknown> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (opts?.ifMatch) {
    headers.set("If-Match", opts.ifMatch);
  }

  const init: RequestInit = { method, signal: opts?.signal, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await wgwFetch(path, init);
  if (!res.ok) {
    let code: string | undefined;
    try {
      const body = (await res.json()) as { code?: string };
      if (typeof body.code === "string") code = body.code;
    } catch {
      // Status alone is enough when the body is not JSON.
    }
    throw new NotesVjournalRequestError(
      `${method} ${path} failed (${res.status})`,
      res.status,
      code,
    );
  }
  if (res.status === 204) return undefined;
  return wgwReadJson(res);
}

function parseList<T>(json: unknown): T[] {
  if (!json || typeof json !== "object") return [];
  const list = (json as { list?: T[] }).list;
  return Array.isArray(list) ? list : [];
}

export type NotesChangesDelta = {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
  hasMoreChanges?: boolean;
};

export async function listNotebooks(opts?: {
  signal?: AbortSignal;
}): Promise<NotesVjournalNotebook[]> {
  const json = await requestNotesJson("/notes/notebooks", "GET", undefined, opts);
  return parseList<NotesVjournalNotebook>(json);
}

export async function getNotebook(
  notebookId: string,
  opts?: { signal?: AbortSignal },
): Promise<NotesVjournalNotebook> {
  const json = await requestNotesJson(
    `/notes/notebooks/${encodeURIComponent(notebookId)}`,
    "GET",
    undefined,
    opts,
  );
  return json as NotesVjournalNotebook;
}

function parseChanges(json: unknown): NotesChangesDelta {
  const row = json as Partial<NotesChangesDelta>;
  return {
    oldState: typeof row.oldState === "string" ? row.oldState : "0",
    newState: typeof row.newState === "string" ? row.newState : "0",
    created: Array.isArray(row.created)
      ? row.created.filter((id): id is string => typeof id === "string")
      : [],
    updated: Array.isArray(row.updated)
      ? row.updated.filter((id): id is string => typeof id === "string")
      : [],
    destroyed: Array.isArray(row.destroyed)
      ? row.destroyed.filter((id): id is string => typeof id === "string")
      : [],
    ...(row.hasMoreChanges === true ? { hasMoreChanges: true } : {}),
  };
}

export async function listNotebookChanges(
  since?: string | null,
  opts?: { signal?: AbortSignal },
): Promise<NotesChangesDelta> {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  const query = params.toString();
  const json = await requestNotesJson(
    `/notes/notebooks/changes${query ? `?${query}` : ""}`,
    "GET",
    undefined,
    opts,
  );
  return parseChanges(json);
}

export async function listNoteChanges(
  notebookId: string,
  since?: string | null,
  opts?: { signal?: AbortSignal },
): Promise<NotesChangesDelta> {
  const params = new URLSearchParams();
  params.set("notebookId", notebookId);
  if (since) params.set("since", since);
  const json = await requestNotesJson(
    `/notes/items/changes?${params.toString()}`,
    "GET",
    undefined,
    opts,
  );
  return parseChanges(json);
}

export async function listNotes(opts: {
  notebookId?: string;
  starred?: boolean;
  status?: "active" | "CANCELLED";
  signal?: AbortSignal;
}): Promise<NotesVjournalNote[]> {
  const params = new URLSearchParams();
  if (opts.notebookId) params.set("notebookId", opts.notebookId);
  if (opts.starred === true) params.set("starred", "true");
  if (opts.status) params.set("status", opts.status);
  const query = params.toString();
  const json = await requestNotesJson(
    `/notes/items${query ? `?${query}` : ""}`,
    "GET",
    undefined,
    opts,
  );
  return parseList<NotesVjournalNote>(json);
}

export async function getNote(
  noteId: string,
  opts?: { signal?: AbortSignal },
): Promise<NotesVjournalNote> {
  const json = await requestNotesJson(
    `/notes/items/${encodeURIComponent(noteId)}`,
    "GET",
    undefined,
    opts,
  );
  return json as NotesVjournalNote;
}

export async function createNote(
  body: {
    notebookId: string;
    title?: string | null;
    body?: string;
    categories?: string[];
    status?: "FINAL" | "CANCELLED" | null;
    uid?: string;
  },
  opts?: NotesRequestOpts,
): Promise<NotesVjournalNote> {
  const json = await requestNotesJson("/notes/items", "POST", body, opts);
  return json as NotesVjournalNote;
}

export async function patchNote(
  noteId: string,
  patch: {
    notebookId?: string;
    title?: string | null;
    body?: string;
    categories?: string[];
    status?: "FINAL" | "CANCELLED" | null;
  },
  opts?: NotesRequestOpts,
): Promise<NotesVjournalNote> {
  const json = await requestNotesJson(
    `/notes/items/${encodeURIComponent(noteId)}`,
    "PATCH",
    patch,
    opts,
  );
  return json as NotesVjournalNote;
}

export async function deleteNote(noteId: string, opts?: NotesRequestOpts): Promise<void> {
  await requestNotesJson(`/notes/items/${encodeURIComponent(noteId)}`, "DELETE", undefined, opts);
}

export async function starNote(noteId: string, opts?: NotesRequestOpts): Promise<void> {
  await requestNotesJson(
    `/notes/items/${encodeURIComponent(noteId)}/star`,
    "POST",
    undefined,
    opts,
  );
}

export async function unstarNote(noteId: string, opts?: NotesRequestOpts): Promise<void> {
  await requestNotesJson(
    `/notes/items/${encodeURIComponent(noteId)}/star`,
    "DELETE",
    undefined,
    opts,
  );
}

export async function createNotebook(
  body: { name: string; color?: string | null; groupSlug?: string | null },
  opts?: NotesRequestOpts,
): Promise<NotesVjournalNotebook> {
  const json = await requestNotesJson("/notes/notebooks", "POST", body, opts);
  return json as NotesVjournalNotebook;
}

export async function patchNotebook(
  notebookId: string,
  patch: {
    name?: string;
    color?: string | null;
    groupSlug?: string | null;
    shareWith?: Record<string, { mayWriteAll?: boolean; mayReadItems?: boolean } | null> | null;
  },
  opts?: NotesRequestOpts,
): Promise<NotesVjournalNotebook> {
  const json = await requestNotesJson(
    `/notes/notebooks/${encodeURIComponent(notebookId)}`,
    "PATCH",
    patch,
    opts,
  );
  return json as NotesVjournalNotebook;
}

export async function deleteNotebook(
  notebookId: string,
  opts?: NotesRequestOpts & { onDestroyRemoveContents?: boolean },
): Promise<void> {
  const query = opts?.onDestroyRemoveContents === true ? "?onDestroyRemoveContents=1" : "";
  await requestNotesJson(
    `/notes/notebooks/${encodeURIComponent(notebookId)}${query}`,
    "DELETE",
    undefined,
    opts,
  );
}

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
  const text = markdownToPlainText(body);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function noteFromVjournal(
  row: NotesVjournalNote,
  notebooks: readonly NotesVjournalNotebook[],
): Note {
  const notebook = notebooks.find((item) => item.id === row.notebookId);
  const body = splitBodyParagraphs(row.body ?? "");
  const flat = body.join("\n\n");
  const title = row.title ?? autofillNoteTitle(row.title, row.body ?? "");
  const metadataUpdatedAt = row.updatedAt;
  // Same display rule as noteFromWgwItem: content mtime, else LAST-MODIFIED/DTSTAMP.
  const displayDate = row.contentUpdatedAt ?? metadataUpdatedAt ?? "—";
  return {
    id: row.id,
    notebook: notebook?.name ?? row.notebookId,
    notebookId: row.notebookId,
    title: title ?? undefined,
    etag: row.etag,
    excerpt: excerptFromBody(row.body ?? ""),
    body,
    tags: row.categories ?? [],
    wordCount: wordCountFromText(flat),
    category: "Note",
    date: displayDate,
    ...(metadataUpdatedAt !== undefined ? { updatedAt: metadataUpdatedAt } : {}),
    starred: row.starred,
    archived: row.status === "CANCELLED",
    scope: notebook?.scope,
    groupSlug: notebook?.groupSlug,
    myRights: notebook?.myRights
      ? { mayEditContent: notebook.myRights.mayWriteAll === true }
      : undefined,
    isShared: notebook?.isSharee === true || Boolean(notebook?.shareWith),
  };
}

export async function fetchNotesVjournalBootstrap(): Promise<NotesAppBootstrap> {
  const session = await wgwFetchPrincipal();
  let groups: NotesAppBootstrap["data"]["groups"] = [];
  const settingsRes = await wgwFetch("/settings/state");
  if (settingsRes.ok) {
    const settings = (await wgwReadJson(settingsRes)) as {
      groups?: { id: string; displayName: string }[];
    };
    if (Array.isArray(settings.groups)) {
      groups = mapTaskProjectGroups(settings.groups);
    }
  }
  const notebooks = await listNotebooks();
  const notes: Note[] = [];
  for (const notebook of notebooks) {
    const items = await listNotes({ notebookId: notebook.id });
    for (const item of items) {
      notes.push(noteFromVjournal(item, notebooks));
    }
  }
  const tags = [...new Set(notes.flatMap((note) => note.tags))];
  const ownedNames = notebooks
    .filter((notebook) => !notebook.isSharee)
    .map((notebook) => notebook.name);
  return {
    data: {
      notes,
      notebooks: ownedNames,
      tags,
      notebookCollections: notebooks,
      groups,
    },
    session,
  };
}

export async function persistNoteMarkdown(
  noteId: string,
  markdown: string,
  etag: string,
  opts?: { signal?: AbortSignal },
): Promise<NotesVjournalNote> {
  const current = await getNote(noteId, opts);
  const title = autofillNoteTitle(current.title, markdown);
  return patchNote(
    noteId,
    { body: markdown, ...(title !== current.title ? { title } : {}) },
    { ...opts, ifMatch: etag },
  );
}
