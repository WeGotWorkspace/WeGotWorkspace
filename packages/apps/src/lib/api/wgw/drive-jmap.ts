import { wgwApiBaseUrl, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import {
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  JmapClient,
  JmapFileNodePathCache,
  JmapFileNodesClient,
  JmapSetItemError,
  type JmapFileNode,
} from "@/lib/jmap-client";
import { normalizeApiVirtualPath as normalizePath, parentAndName } from "@/lib/files/api-path";
import type {
  WgwDriveDirectoryEntry,
  WgwDriveUserData,
  WgwDriveUserResponse,
  WgwPluginDescriptor,
} from "@/lib/api/wgw/types";
import type {
  DriveMutationOpts,
  DriveUIData,
  DriveUploadProgress,
} from "@/drive-core/src/drive-types";

export const JMAP_MAX_SIZE_UPLOAD_DEFAULT = 25_000_000;

export type DriveJmapSession = {
  client: JmapClient;
  fileNodes: JmapFileNodesClient;
  cache: JmapFileNodePathCache;
  accountId: string;
  maxSizeUpload: number;
  uploadUrl: string;
  downloadUrl: string;
};

let cachedSession: DriveJmapSession | null = null;

function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const raw = String(input);
  if (raw.startsWith("/")) {
    return raw.startsWith(base) ? raw.slice(base.length) : raw;
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(raw, origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

export function expandJmapUrl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? ""));
}

export function maxSizeUploadError(fileName: string, maxBytes: number): Error {
  const mb = Math.round(maxBytes / 1_000_000);
  return new Error(`File "${fileName}" exceeds maxSizeUpload (${mb} MB).`);
}

function isVisibleDriveEntry(entry: WgwDriveDirectoryEntry): boolean {
  return !entry.name.trim().startsWith(".");
}

export function createDriveJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}

export function resetDriveJmapSessionForTests(): void {
  cachedSession = null;
}

export async function driveJmapSession(): Promise<DriveJmapSession> {
  if (cachedSession) return cachedSession;
  const client = createDriveJmapClient();
  const session = await client.connect();
  if (!(FILENODE_CAPABILITY in session.capabilities)) {
    throw new Error("JMAP session does not advertise FileNode.");
  }
  const core = session.capabilities[CORE_CAPABILITY] as { maxSizeUpload?: number } | undefined;
  cachedSession = {
    client,
    fileNodes: new JmapFileNodesClient(client),
    cache: new JmapFileNodePathCache(),
    accountId: client.primaryAccountId(FILENODE_CAPABILITY),
    maxSizeUpload:
      typeof core?.maxSizeUpload === "number" ? core.maxSizeUpload : JMAP_MAX_SIZE_UPLOAD_DEFAULT,
    uploadUrl: session.uploadUrl,
    downloadUrl: session.downloadUrl,
  };
  return cachedSession;
}

export function fileNodeToDirectoryEntry(path: string, node: JmapFileNode): WgwDriveDirectoryEntry {
  const rights = node.myRights;
  const modified = typeof node.modified === "string" ? Date.parse(node.modified) : Number.NaN;
  return {
    type: node.nodeType === "directory" ? "dir" : "file",
    path,
    name: node.name,
    size: node.size ?? 0,
    time: Number.isFinite(modified) ? Math.floor(modified / 1000) : 0,
    permissions: 0,
    myRights: {
      mayView: rights?.mayRead !== false,
      mayComment: false,
      mayReview: false,
      mayEditContent: rights?.mayModifyContent === true,
      mayManageStructure:
        rights?.mayAddChildren === true || rights?.mayRename === true || rights?.mayDelete === true,
      mayShare: rights?.mayShare === true,
    },
  };
}

async function ensureTopLevel(
  session: DriveJmapSession,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  if (session.cache.nodeIdForPath(session.cache.homePath(username))) return;
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { isTopLevel: true },
    { signal },
  );
  session.cache.rememberTopLevel(username, got.list);
}

export async function resolveFileNodeId(
  session: DriveJmapSession,
  path: string,
  username: string,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = normalizePath(path);
  const home = session.cache.homePath(username);
  const target = normalized === "/" || normalized === "/users" ? home : normalized;
  const cachedId = session.cache.nodeIdForPath(target);
  if (cachedId) return cachedId;

  await ensureTopLevel(session, username, signal);
  const afterRoots = session.cache.nodeIdForPath(target);
  if (afterRoots) return afterRoots;

  const parts = target.split("/").filter(Boolean);
  let prefix: string;
  let rest: string[];
  if (parts[0] === "users" && parts[1] === username) {
    prefix = home;
    rest = parts.slice(2);
  } else if (parts[0] === "groups" && parts[1]) {
    prefix = `/groups/${parts[1]}`;
    rest = parts.slice(2);
  } else {
    throw new Error(`Unsupported drive path: ${normalized}`);
  }

  let parentId = session.cache.nodeIdForPath(prefix);
  if (!parentId) throw new Error(`FileNode not found: ${prefix}`);
  let current = prefix;
  for (const name of rest) {
    const got = await session.fileNodes.queryAndGetFileNodes(
      session.accountId,
      { parentId, name },
      { signal },
    );
    const node = got.list[0];
    if (!node) throw new Error(`FileNode not found: ${current}/${name}`);
    current = `${current}/${name}`;
    session.cache.remember(current, node);
    parentId = node.id;
  }
  return parentId;
}

export async function listFileNodeEntries(
  session: DriveJmapSession,
  dir: string,
  username: string,
  opts?: { includeHidden?: boolean; signal?: AbortSignal },
): Promise<WgwDriveDirectoryEntry[]> {
  const normalized = normalizePath(dir);

  if (normalized === "/groups") {
    const got = await session.fileNodes.queryAndGetFileNodes(
      session.accountId,
      { isTopLevel: true },
      { signal: opts?.signal },
    );
    const home = session.cache.homePath(username);
    const remembered = session.cache.rememberTopLevel(username, got.list);
    const entries = remembered
      .filter((row) => row.path !== home)
      .map((row) => fileNodeToDirectoryEntry(row.path, row.node));
    return opts?.includeHidden ? entries : entries.filter(isVisibleDriveEntry);
  }

  const parentId = await resolveFileNodeId(session, normalized, username, opts?.signal);
  const location =
    normalized === "/" || normalized === "/users" ? session.cache.homePath(username) : normalized;
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId },
    { signal: opts?.signal },
  );
  const remembered = session.cache.rememberChildren(location, got.list);
  const entries = remembered.map((row) => fileNodeToDirectoryEntry(row.path, row.node));
  return opts?.includeHidden ? entries : entries.filter(isVisibleDriveEntry);
}

export async function fetchDriveUser(opts?: { signal?: AbortSignal }): Promise<WgwDriveUserData> {
  const res = await wgwFetch("/files/context", { signal: opts?.signal });
  if (!res.ok) throw new Error(`GET /files/context failed (${res.status})`);
  const payload = (await wgwReadJson(res)) as WgwDriveUserResponse;
  return payload.data;
}

export async function fetchSignedInDriveState(
  dir: string,
  opts?: { signal?: AbortSignal },
  plugins: WgwPluginDescriptor[] = [],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const userRoot = normalizePath(`/users/${user.username}`);
  const requested = normalizePath(dir);
  const targetDir = requested === "/" || requested === "/users" ? userRoot : requested;
  const files = await listFileNodeEntries(session, targetDir, user.username, {
    signal: opts?.signal,
  });
  const directory = { location: targetDir, files };

  if (normalizePath(directory.location) === userRoot) {
    try {
      const groupFolders = await listFileNodeEntries(session, "/groups", user.username, {
        signal: opts?.signal,
      });
      const existing = new Set(directory.files.map((entry) => normalizePath(entry.path)));
      const extra = groupFolders.filter(
        (entry) => entry.type === "dir" && !existing.has(normalizePath(entry.path)),
      );
      return {
        user,
        cwd: directory.location,
        directory: { ...directory, files: [...directory.files, ...extra] },
        plugins,
      };
    } catch {
      // Group merge is additive only.
    }
  }

  return { user, cwd: directory.location, directory, plugins };
}

async function setIgnoringAlreadyExists(
  session: DriveJmapSession,
  args: Parameters<JmapFileNodesClient["setFileNodes"]>[0],
  signal?: AbortSignal,
): Promise<void> {
  try {
    await session.fileNodes.setFileNodes(args, { signal });
  } catch (error) {
    if (error instanceof JmapSetItemError && error.setError.type === "alreadyExists") return;
    throw error;
  }
}

export async function uploadJmapBlob(
  session: DriveJmapSession,
  contents: Blob,
  mediaType: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = expandJmapUrl(session.uploadUrl, { accountId: session.accountId });
  const res = await wgwFetch(toApiRelativePath(url), {
    method: "POST",
    headers: { "Content-Type": mediaType || "application/octet-stream" },
    body: contents,
    signal,
  });
  if (!res.ok) throw new Error(`POST /jmap/upload failed (${res.status})`);
  const payload = (await res.json()) as { blobId?: string };
  if (!payload.blobId) throw new Error("JMAP upload returned no blobId");
  return payload.blobId;
}

export async function downloadFileNodeBlob(
  session: DriveJmapSession,
  path: string,
  username: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const nodeId = await resolveFileNodeId(session, path, username, signal);
  let node = session.cache.node(nodeId);
  if (!node?.blobId) {
    const got = await session.fileNodes.getFileNodes(session.accountId, [nodeId], { signal });
    node = got.list[0];
    if (node) session.cache.remember(path, node);
  }
  if (!node?.blobId) throw new Error(`FileNode has no blobId: ${path}`);
  const url = expandJmapUrl(session.downloadUrl, {
    accountId: session.accountId,
    blobId: node.blobId,
    name: node.name || parentAndName(path).from || "download",
    type: node.type || "application/octet-stream",
  });
  const res = await wgwFetch(toApiRelativePath(url), { signal });
  if (!res.ok) throw new Error(`GET /jmap/download failed (${res.status})`);
  return res.blob();
}

function emptyState(cwd: string, plugins: WgwPluginDescriptor[]): DriveUIData {
  return {
    user: { username: "", name: "", role: "user", roots: [] },
    cwd,
    directory: { location: cwd, files: [] },
    plugins,
  };
}

export async function createFileNodeFolder(
  parent: string,
  name: string,
  opts: DriveMutationOpts | undefined,
  cwd: string,
  plugins: WgwPluginDescriptor[],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const parentId = await resolveFileNodeId(session, parent, user.username, opts?.signal);
  const created = await (async () => {
    try {
      return await session.fileNodes.setFileNodes(
        { accountId: session.accountId, create: { d0: { parentId, name } } },
        { signal: opts?.signal },
      );
    } catch (error) {
      if (error instanceof JmapSetItemError && error.setError.type === "alreadyExists") return null;
      throw error;
    }
  })();
  const node = created?.created?.d0;
  if (node?.id) {
    session.cache.remember(parent === "/" ? `/${name}` : `${normalizePath(parent)}/${name}`, {
      ...node,
      id: node.id,
      parentId: node.parentId ?? parentId,
      nodeType: node.nodeType ?? "directory",
      blobId: node.blobId ?? null,
      name: node.name ?? name,
      size: node.size ?? null,
      type: node.type ?? null,
    });
  }
  if (opts?.refreshState === false) return emptyState(cwd, plugins);
  return fetchSignedInDriveState(cwd, opts, plugins);
}

export async function createFileNodeFile(
  parent: string,
  name: string,
  opts: DriveMutationOpts | undefined,
  cwd: string,
  plugins: WgwPluginDescriptor[],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const parentId = await resolveFileNodeId(session, parent, user.username, opts?.signal);
  const blobId = await uploadJmapBlob(
    session,
    new Blob([]),
    "application/octet-stream",
    opts?.signal,
  );
  await setIgnoringAlreadyExists(
    session,
    { accountId: session.accountId, create: { f0: { parentId, name, blobId } } },
    opts?.signal,
  );
  if (opts?.refreshState === false) return emptyState(cwd, plugins);
  return fetchSignedInDriveState(cwd, opts, plugins);
}

export async function renameFileNode(
  fromPath: string,
  destination: string,
  toName: string,
  opts: DriveMutationOpts | undefined,
  cwd: string,
  plugins: WgwPluginDescriptor[],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const nodeId = await resolveFileNodeId(session, fromPath, user.username, opts?.signal);
  const destParent = normalizePath(destination);
  const currentParent = parentAndName(fromPath).destination;
  const patch: Record<string, unknown> = {};
  if (toName !== parentAndName(fromPath).from) patch.name = toName;
  if (destParent !== currentParent) {
    patch.parentId = await resolveFileNodeId(session, destParent, user.username, opts?.signal);
  }
  if (Object.keys(patch).length > 0) {
    await session.fileNodes.setFileNodes(
      { accountId: session.accountId, update: { [nodeId]: patch } },
      { signal: opts?.signal },
    );
  }
  const nextPath = destParent === "/" ? `/${toName}` : `${destParent}/${toName}`;
  session.cache.movePath(fromPath, nextPath);
  if (opts?.refreshState === false) return emptyState(cwd, plugins);
  return fetchSignedInDriveState(cwd, opts, plugins);
}

export async function destroyFileNodes(
  paths: string[],
  opts: DriveMutationOpts | undefined,
  cwd: string,
  plugins: WgwPluginDescriptor[],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const ids: string[] = [];
  for (const path of paths) {
    ids.push(await resolveFileNodeId(session, path, user.username, opts?.signal));
  }
  await session.fileNodes.setFileNodes(
    { accountId: session.accountId, destroy: ids, onDestroyRemoveChildren: true },
    { signal: opts?.signal },
  );
  for (const path of paths) session.cache.forgetSubtree(path);
  return fetchSignedInDriveState(cwd, opts, plugins);
}

export async function uploadFileNodes(
  targetCwd: string,
  files: File[],
  opts: (DriveMutationOpts & { onProgress?: (progress: DriveUploadProgress) => void }) | undefined,
  plugins: WgwPluginDescriptor[],
): Promise<DriveUIData> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const parentId = await resolveFileNodeId(session, targetCwd, user.username, opts?.signal);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let uploadedBytes = 0;
  let filesCompleted = 0;
  const publish = (currentFileName: string) => {
    opts?.onProgress?.({
      uploadedBytes,
      totalBytes,
      uploadedChunks: filesCompleted,
      totalChunks: files.length,
      currentFileName,
      filesCompleted,
      filesTotal: files.length,
    });
  };
  publish(files[0]?.name ?? "");

  for (const file of files) {
    if (file.size > session.maxSizeUpload) {
      throw maxSizeUploadError(file.name, session.maxSizeUpload);
    }
    const blobId = await uploadJmapBlob(
      session,
      file,
      file.type || "application/octet-stream",
      opts?.signal,
    );
    const existing = await session.fileNodes.queryAndGetFileNodes(
      session.accountId,
      { parentId, name: file.name },
      { signal: opts?.signal },
    );
    const existingNode = existing.list[0];
    if (existingNode && existingNode.nodeType !== "directory") {
      await session.fileNodes.setFileNodes(
        { accountId: session.accountId, update: { [existingNode.id]: { blobId } } },
        { signal: opts?.signal },
      );
    } else {
      await session.fileNodes.setFileNodes(
        {
          accountId: session.accountId,
          create: { f0: { parentId, name: file.name, blobId } },
        },
        { signal: opts?.signal },
      );
    }
    uploadedBytes += file.size;
    filesCompleted += 1;
    publish(file.name);
  }

  return fetchSignedInDriveState(targetCwd, opts, plugins);
}

export async function listFileNodeEntriesByPaths(
  paths: string[],
  opts?: { signal?: AbortSignal },
): Promise<WgwDriveDirectoryEntry[]> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const normalized = Array.from(
    new Set(
      paths.map((path) => normalizePath(path)).filter((path) => path !== "/" && path.length > 1),
    ),
  );
  if (normalized.length === 0) return [];

  const parentDirs = Array.from(new Set(normalized.map((path) => parentAndName(path).destination)));
  const entriesByPath = new Map<string, WgwDriveDirectoryEntry>();
  await Promise.all(
    parentDirs.map(async (dir) => {
      try {
        const listing = await listFileNodeEntries(session, dir, user.username, {
          signal: opts?.signal,
        });
        for (const entry of listing) entriesByPath.set(normalizePath(entry.path), entry);
      } catch {
        // Skip unreadable parents; keep partial results (starred list).
      }
    }),
  );
  return normalized
    .map((path) => entriesByPath.get(path))
    .filter((entry): entry is WgwDriveDirectoryEntry => !!entry);
}
