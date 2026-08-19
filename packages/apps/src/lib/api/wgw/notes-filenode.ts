import type { Note } from "@/lib/models/note";
import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import { normalizeApiVirtualPath as normalizePath } from "@/lib/files/api-path";
import {
  driveJmapSession,
  fetchDriveUser,
  resolveFileNodeId,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import { setDriveFileStar } from "@/lib/api/wgw/drive";
import { JmapSetItemError, type JmapFileNode, type JmapFileNodeNote } from "@/lib/jmap-client";
import { noteCollabPath, type NoteCollabScope } from "@/notes-core/src/note-collab-path";
import type { NotesNotebookRow, NotesSharedNotebookEntry } from "@/lib/api/wgw/notes";

export class NotesRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type NotesFileNodeRoot = {
  id: string;
  path: string;
  scope: "personal" | "group";
  groupSlug: string | null;
};

export type ParsedNotePath = {
  scope: "personal" | "group";
  owner: string;
  groupSlug: string | null;
  notebook: string;
  noteId: string;
  archived: boolean;
  path: string;
};

export type OwnedNotesFileNodeListing = {
  notes: Note[];
  notebooks: string[];
  notebookRows: NotesNotebookRow[];
  sharedNotebooks: NotesSharedNotebookEntry[];
  username: string;
};

const NOTE_PATH_RE = /^\/(users|groups)\/([^/]+)\/\.notes\/(?:\.archive\/)?([^/]+)\/([^/]+)\.md$/;

export function isNotesVirtualPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.includes("/.notes/") && normalized.endsWith(".md");
}

export function parseNoteVirtualPath(path: string): ParsedNotePath | null {
  const normalized = normalizePath(path);
  const match = NOTE_PATH_RE.exec(normalized);
  if (!match) return null;
  const [, kind, owner, notebook, noteId] = match;
  if (!kind || !owner || !notebook || !noteId) return null;
  const archived = normalized.includes("/.notes/.archive/");
  const scope = kind === "groups" ? "group" : "personal";
  return {
    scope,
    owner,
    groupSlug: scope === "group" ? owner : null,
    notebook,
    noteId,
    archived,
    path: normalized,
  };
}

export function noteIdFromFileName(name: string): string | null {
  if (!name.toLowerCase().endsWith(".md")) return null;
  const id = name.slice(0, -3);
  return id.trim() ? id : null;
}

export function coerceFileNodeNote(raw: unknown): JmapFileNodeNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.notebook !== "string" || !r.notebook.trim()) return null;
  const tagsRaw = r.tags;
  return {
    title: typeof r.title === "string" ? r.title : "",
    tags: Array.isArray(tagsRaw) ? tagsRaw.map((tag) => String(tag)).filter(Boolean) : [],
    excerpt: typeof r.excerpt === "string" ? r.excerpt : "",
    notebook: r.notebook,
    archived: r.archived === true,
    starred: r.starred === true,
  };
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

function excerptFromText(body: string, max = 180): string {
  const text = markdownToPlainText(body);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function noteFromFileNodeNote(args: {
  id: string;
  projection: JmapFileNodeNote;
  path: string;
  scope: "personal" | "group";
  groupSlug?: string | null;
  modified?: string;
  changed?: string;
}): Note {
  const preview = args.projection.excerpt.trim() || args.projection.title.trim();
  const body = splitBodyParagraphs(preview);
  const metadataUpdatedAt = args.changed;
  const displayDate = args.modified ?? metadataUpdatedAt ?? "—";
  return {
    id: args.id,
    notebook: args.projection.notebook,
    excerpt: excerptFromText(preview),
    body,
    tags: args.projection.tags,
    wordCount: wordCountFromText(body.join("\n\n")),
    category: "Note",
    date: displayDate,
    ...(metadataUpdatedAt !== undefined ? { updatedAt: metadataUpdatedAt } : {}),
    starred: args.projection.starred,
    archived: args.projection.archived,
    scope: args.scope,
    ...(args.scope === "group" ? { groupSlug: args.groupSlug ?? null } : {}),
    apiPath: args.path,
  };
}

function scopeFromRoot(root: NotesFileNodeRoot): NoteCollabScope {
  return root.scope === "group" && root.groupSlug
    ? { kind: "group", slug: root.groupSlug }
    : { kind: "personal", username: root.path.split("/")[2] ?? "" };
}

function virtualPathForNote(
  root: NotesFileNodeRoot,
  projection: JmapFileNodeNote,
  noteId: string,
): string {
  const path = noteCollabPath({
    scope: scopeFromRoot(root),
    notebook: projection.notebook,
    noteId,
    archived: projection.archived,
  });
  return path.startsWith("/") ? path : `/${path}`;
}

function isHiddenNotesDir(name: string): boolean {
  return name.startsWith(".") && name !== ".archive";
}

async function notesSession(opts?: { signal?: AbortSignal }): Promise<{
  session: DriveJmapSession;
  username: string;
}> {
  const [session, user] = await Promise.all([driveJmapSession(), fetchDriveUser(opts)]);
  return { session, username: user.username };
}

async function ensureChildDirectory(
  session: DriveJmapSession,
  parentPath: string,
  name: string,
  username: string,
  signal?: AbortSignal,
): Promise<string> {
  const childPath = `${normalizePath(parentPath)}/${name}`;
  try {
    return await resolveFileNodeId(session, childPath, username, signal);
  } catch {
    const parentId = await resolveFileNodeId(session, parentPath, username, signal);
    try {
      const created = await session.fileNodes.setFileNodes(
        { accountId: session.accountId, create: { d0: { parentId, name } } },
        { signal },
      );
      const node = created.created?.d0;
      if (node?.id) {
        session.cache.remember(childPath, {
          id: node.id,
          parentId: node.parentId ?? parentId,
          nodeType: node.nodeType ?? "directory",
          blobId: node.blobId ?? null,
          name: node.name ?? name,
          size: node.size ?? null,
          type: node.type ?? null,
        });
        return node.id;
      }
    } catch (error) {
      if (!(error instanceof JmapSetItemError && error.setError.type === "alreadyExists")) {
        throw error;
      }
    }
    return resolveFileNodeId(session, childPath, username, signal);
  }
}

export async function listNotesFileNodeRoots(opts?: {
  signal?: AbortSignal;
}): Promise<{ roots: NotesFileNodeRoot[]; username: string }> {
  const { session, username } = await notesSession(opts);
  const roots: NotesFileNodeRoot[] = [];

  try {
    const personalPath = `/users/${username}/.notes`;
    const id = await resolveFileNodeId(session, personalPath, username, opts?.signal);
    roots.push({ id, path: personalPath, scope: "personal", groupSlug: null });
  } catch {
    // Empty personal tree is valid — first create will mkdir `.notes`.
  }

  const top = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { isTopLevel: true },
    { signal: opts?.signal },
  );
  session.cache.rememberTopLevel(username, top.list);
  for (const node of top.list) {
    if (node.name === username) continue;
    const groupPath = `/groups/${node.name}`;
    session.cache.remember(groupPath, node);
    try {
      const notesPath = `${groupPath}/.notes`;
      const id = await resolveFileNodeId(session, notesPath, username, opts?.signal);
      roots.push({ id, path: notesPath, scope: "group", groupSlug: node.name });
    } catch {
      // Group without a notes tree.
    }
  }

  return { roots, username };
}

export async function listOwnedNotesFromFileNodes(opts?: {
  signal?: AbortSignal;
}): Promise<OwnedNotesFileNodeListing> {
  const { session, username } = await notesSession(opts);
  const { roots } = await listNotesFileNodeRoots(opts);
  const notes: Note[] = [];
  const personalNotebooks = new Set<string>();
  const notebookRows: NotesNotebookRow[] = [];
  const sharedNotebooks: NotesSharedNotebookEntry[] = [];

  for (const root of roots) {
    const got = await session.fileNodes.queryAndGetFileNodes(
      session.accountId,
      { ancestorId: root.id },
      { signal: opts?.signal },
    );
    for (const node of got.list) {
      if (node.nodeType === "directory") {
        if (isHiddenNotesDir(node.name) || node.name === ".archive") continue;
        if (node.parentId !== root.id) continue;
        if (root.scope === "personal") {
          personalNotebooks.add(node.name);
          notebookRows.push({ name: node.name, scope: "personal", groupSlug: null });
        } else if (root.groupSlug) {
          notebookRows.push({
            name: node.name,
            scope: "group",
            groupSlug: root.groupSlug,
          });
          sharedNotebooks.push({
            path: `${root.path}/${node.name}`,
            notebook: node.name,
            owner: root.groupSlug,
            scope: "group",
            groupSlug: root.groupSlug,
          });
        }
        continue;
      }
      const noteId = noteIdFromFileName(node.name);
      const projection = coerceFileNodeNote(node.note);
      if (!noteId || !projection) continue;
      const path = virtualPathForNote(root, projection, noteId);
      notes.push(
        noteFromFileNodeNote({
          id: noteId,
          projection,
          path,
          scope: root.scope,
          groupSlug: root.groupSlug,
          modified: typeof node.modified === "string" ? node.modified : undefined,
          changed: typeof node.changed === "string" ? node.changed : undefined,
        }),
      );
      if (root.scope === "personal") personalNotebooks.add(projection.notebook);
    }
  }

  sharedNotebooks.sort((a, b) => a.notebook.localeCompare(b.notebook));
  return {
    notes,
    notebooks: [...personalNotebooks].filter((name) => name.trim()),
    notebookRows,
    sharedNotebooks,
    username,
  };
}

export type FoundNoteFileNode = {
  node: JmapFileNode;
  projection: JmapFileNodeNote;
  path: string;
  root: NotesFileNodeRoot;
  noteId: string;
};

export async function findNoteFileNode(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null },
): Promise<FoundNoteFileNode | null> {
  const { session } = await notesSession(opts);
  const { roots } = await listNotesFileNodeRoots(opts);
  const filename = `${id}.md`;
  const slug = opts?.groupSlug?.trim();
  const candidates = slug
    ? roots.filter((root) => root.scope === "group" && root.groupSlug === slug)
    : roots;

  for (const root of candidates) {
    const got = await session.fileNodes.queryAndGetFileNodes(
      session.accountId,
      { ancestorId: root.id, name: filename },
      { signal: opts?.signal },
    );
    const node = got.list.find((entry) => entry.nodeType === "file");
    const projection = node ? coerceFileNodeNote(node.note) : null;
    if (!node || !projection) continue;
    return {
      node,
      projection,
      path: virtualPathForNote(root, projection, id),
      root,
      noteId: id,
    };
  }
  return null;
}

async function applyDriveStar(
  path: string,
  starred: boolean | undefined,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  if (starred === undefined) return;
  await setDriveFileStar(path, starred, opts);
}

function noteFromFound(
  found: FoundNoteFileNode,
  overrides?: Partial<Pick<Note, "starred" | "archived" | "notebook" | "tags">>,
): Note {
  return noteFromFileNodeNote({
    id: found.noteId,
    projection: {
      ...found.projection,
      ...(overrides?.tags ? { tags: overrides.tags } : {}),
      ...(overrides?.notebook ? { notebook: overrides.notebook } : {}),
      ...(overrides?.archived !== undefined ? { archived: overrides.archived } : {}),
      ...(overrides?.starred !== undefined ? { starred: overrides.starred } : {}),
    },
    path: found.path,
    scope: found.root.scope,
    groupSlug: found.root.groupSlug,
    modified: typeof found.node.modified === "string" ? found.node.modified : undefined,
    changed: typeof found.node.changed === "string" ? found.node.changed : undefined,
  });
}

export async function createNoteViaFileNode(
  input: {
    id: string;
    notebook: string;
    tags?: string[];
    title?: string;
    starred?: boolean;
    archived?: boolean;
    groupSlug?: string | null;
  },
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const { session, username } = await notesSession(opts);
  const groupSlug = input.groupSlug?.trim() || null;
  const rootPath = groupSlug ? `/groups/${groupSlug}/.notes` : `/users/${username}/.notes`;
  const homePath = groupSlug ? `/groups/${groupSlug}` : `/users/${username}`;
  await ensureChildDirectory(session, homePath, ".notes", username, opts?.signal);
  const destParent = input.archived
    ? `${rootPath}/.archive/${input.notebook}`
    : `${rootPath}/${input.notebook}`;
  if (input.archived) {
    await ensureChildDirectory(session, rootPath, ".archive", username, opts?.signal);
    await ensureChildDirectory(
      session,
      `${rootPath}/.archive`,
      input.notebook,
      username,
      opts?.signal,
    );
  } else {
    await ensureChildDirectory(session, rootPath, input.notebook, username, opts?.signal);
  }
  const parentId = await resolveFileNodeId(session, destParent, username, opts?.signal);
  const created = await session.fileNodes.setFileNodes(
    {
      accountId: session.accountId,
      create: {
        n0: {
          parentId,
          name: `${input.id}.md`,
          note: {
            title: input.title ?? "",
            tags: input.tags ?? [],
          },
        },
      },
    },
    { signal: opts?.signal },
  );
  const node = created.created?.n0;
  const projection =
    coerceFileNodeNote(node?.note) ??
    ({
      title: input.title ?? "",
      tags: input.tags ?? [],
      excerpt: "",
      notebook: input.notebook,
      archived: !!input.archived,
      starred: false,
    } satisfies JmapFileNodeNote);
  const root: NotesFileNodeRoot = {
    id: parentId,
    path: rootPath,
    scope: groupSlug ? "group" : "personal",
    groupSlug,
  };
  const path = virtualPathForNote(root, projection, input.id);
  await applyDriveStar(path, input.starred, opts);
  return noteFromFileNodeNote({
    id: input.id,
    projection: { ...projection, starred: input.starred === true },
    path,
    scope: root.scope,
    groupSlug,
    modified: typeof node?.modified === "string" ? node.modified : undefined,
    changed: typeof node?.changed === "string" ? node.changed : undefined,
  });
}

async function moveNoteToNotebook(
  session: DriveJmapSession,
  found: FoundNoteFileNode,
  notebook: string,
  archived: boolean,
  username: string,
  signal?: AbortSignal,
): Promise<string> {
  const destParent = archived
    ? `${found.root.path}/.archive/${notebook}`
    : `${found.root.path}/${notebook}`;
  if (archived) {
    await ensureChildDirectory(session, found.root.path, ".archive", username, signal);
    await ensureChildDirectory(session, `${found.root.path}/.archive`, notebook, username, signal);
  } else {
    await ensureChildDirectory(session, found.root.path, notebook, username, signal);
  }
  const parentId = await resolveFileNodeId(session, destParent, username, signal);
  if (parentId !== found.node.parentId) {
    await session.fileNodes.setFileNodes(
      { accountId: session.accountId, update: { [found.node.id]: { parentId } } },
      { signal },
    );
  }
  return destParent;
}

export async function updateNoteViaFileNode(
  id: string,
  input: {
    notebook: string;
    tags?: string[];
    starred?: boolean;
    archived?: boolean;
    groupSlug?: string | null;
  },
  opts?: { signal?: AbortSignal },
): Promise<Note> {
  const found = await findNoteFileNode(id, {
    signal: opts?.signal,
    groupSlug: input.groupSlug,
  });
  if (!found) {
    throw new NotesRequestError(`FileNode note ${id} not found (404)`, 404);
  }
  const { session, username } = await notesSession(opts);
  const nextArchived = input.archived ?? found.projection.archived;
  const nextNotebook = input.notebook || found.projection.notebook;
  const patch: Record<string, unknown> = {};
  if (input.tags) {
    patch.note = { tags: input.tags };
  }
  const needsMove =
    nextNotebook !== found.projection.notebook || nextArchived !== found.projection.archived;
  if (needsMove) {
    await moveNoteToNotebook(session, found, nextNotebook, nextArchived, username, opts?.signal);
  }
  if (Object.keys(patch).length > 0) {
    await session.fileNodes.setFileNodes(
      { accountId: session.accountId, update: { [found.node.id]: patch } },
      { signal: opts?.signal },
    );
  }
  const nextPath = virtualPathForNote(
    found.root,
    { ...found.projection, notebook: nextNotebook, archived: nextArchived },
    id,
  );
  await applyDriveStar(nextPath, input.starred, opts);
  return noteFromFound(
    { ...found, path: nextPath },
    {
      tags: input.tags ?? found.projection.tags,
      notebook: nextNotebook,
      archived: nextArchived,
      starred: input.starred ?? found.projection.starred,
    },
  );
}

export async function deleteNoteViaFileNode(
  id: string,
  input: { notebook: string; archived: boolean; groupSlug?: string | null },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const found = await findNoteFileNode(id, {
    signal: opts?.signal,
    groupSlug: input.groupSlug,
  });
  if (!found) return;
  const { session } = await notesSession(opts);
  await session.fileNodes.setFileNodes(
    { accountId: session.accountId, destroy: [found.node.id] },
    { signal: opts?.signal },
  );
  session.cache.forgetPath(found.path);
}

export async function archiveNoteViaFileNode(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null },
): Promise<Note> {
  const found = await findNoteFileNode(id, opts);
  if (!found) {
    throw new NotesRequestError(`FileNode note ${id} not found (404)`, 404);
  }
  return updateNoteViaFileNode(
    id,
    {
      notebook: found.projection.notebook,
      archived: true,
      groupSlug: opts?.groupSlug ?? found.root.groupSlug,
    },
    opts,
  );
}

export async function restoreNoteViaFileNode(
  id: string,
  opts?: { signal?: AbortSignal; groupSlug?: string | null },
): Promise<Note> {
  const found = await findNoteFileNode(id, opts);
  if (!found) {
    throw new NotesRequestError(`FileNode note ${id} not found (404)`, 404);
  }
  return updateNoteViaFileNode(
    id,
    {
      notebook: found.projection.notebook,
      archived: false,
      groupSlug: opts?.groupSlug ?? found.root.groupSlug,
    },
    opts,
  );
}

function personalNotesRoot(username: string): string {
  return `/users/${username}/.notes`;
}

export async function createNotebookViaFileNode(
  name: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const { session, username } = await notesSession(opts);
  const home = `/users/${username}`;
  await ensureChildDirectory(session, home, ".notes", username, opts?.signal);
  await ensureChildDirectory(session, personalNotesRoot(username), name, username, opts?.signal);
}

export async function renameNotebookViaFileNode(
  from: string,
  to: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const { session, username } = await notesSession(opts);
  const root = personalNotesRoot(username);
  for (const parent of [root, `${root}/.archive`]) {
    const fromPath = `${parent}/${from}`;
    try {
      const nodeId = await resolveFileNodeId(session, fromPath, username, opts?.signal);
      await session.fileNodes.setFileNodes(
        { accountId: session.accountId, update: { [nodeId]: { name: to } } },
        { signal: opts?.signal },
      );
      session.cache.movePath(fromPath, `${parent}/${to}`);
    } catch {
      // Archived counterpart may not exist.
    }
  }
}

async function moveMarkdownChildren(
  session: DriveJmapSession,
  fromDir: string,
  toDir: string,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  let fromId: string;
  try {
    fromId = await resolveFileNodeId(session, fromDir, username, signal);
  } catch {
    return;
  }
  const destId = await resolveFileNodeId(session, toDir, username, signal);
  const children = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: fromId, nodeType: "file" },
    { signal },
  );
  for (const child of children.list) {
    if (!noteIdFromFileName(child.name)) continue;
    await session.fileNodes.setFileNodes(
      { accountId: session.accountId, update: { [child.id]: { parentId: destId } } },
      { signal },
    );
  }
}

export async function deleteNotebookViaFileNode(
  name: string,
  action: { mode: "archive" | "move" | "purge"; target?: string },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const { session, username } = await notesSession(opts);
  const root = personalNotesRoot(username);
  if (action.mode === "purge") {
    for (const dir of [`${root}/${name}`, `${root}/.archive/${name}`]) {
      try {
        const nodeId = await resolveFileNodeId(session, dir, username, opts?.signal);
        await session.fileNodes.setFileNodes(
          {
            accountId: session.accountId,
            destroy: [nodeId],
            onDestroyRemoveChildren: true,
          },
          { signal: opts?.signal },
        );
        session.cache.forgetSubtree(dir);
      } catch {
        // Missing archive/active dir is fine.
      }
    }
    return;
  }
  if (action.mode === "move") {
    const target = action.target?.trim();
    if (!target || target === name) {
      throw new NotesRequestError("Target notebook must be different.", 400);
    }
    await ensureChildDirectory(session, root, target, username, opts?.signal);
    await moveMarkdownChildren(
      session,
      `${root}/${name}`,
      `${root}/${target}`,
      username,
      opts?.signal,
    );
    try {
      await ensureChildDirectory(session, `${root}/.archive`, target, username, opts?.signal);
      await moveMarkdownChildren(
        session,
        `${root}/.archive/${name}`,
        `${root}/.archive/${target}`,
        username,
        opts?.signal,
      );
    } catch {
      // No archived source.
    }
    return;
  }

  await ensureChildDirectory(session, root, ".archive", username, opts?.signal);
  await ensureChildDirectory(session, `${root}/.archive`, name, username, opts?.signal);
  await moveMarkdownChildren(
    session,
    `${root}/${name}`,
    `${root}/.archive/${name}`,
    username,
    opts?.signal,
  );
}
