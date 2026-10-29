import {
  fetchDriveFileNodeLocation,
  type DriveFileNodeLocateQuery,
  type DriveFileNodeLocation,
} from "@/lib/api/wgw/drive-node-locate";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  readDocsNodeIdForPath,
  readDocsPathForNodeId,
  recordDocsNodePath,
} from "@/lib/offline/docs/docs-node-paths";
import {
  readCachedDriveNodeId,
  readCachedDrivePathForNodeId,
} from "@/lib/offline/drive/drive-directory-offline-store";

/**
 * Finds a Doc by FileNode id, or a Doc's id by path (#1751).
 *
 * Network first: the server knows where a file lives now, and a cached
 * path → id row can be stale once another file took the old path. The offline
 * caches answer only when the request cannot reach the server. Every server
 * answer is recorded, so the same link opens offline later.
 */
export type DocsLocatorDeps = {
  fetchLocation: (
    query: DriveFileNodeLocateQuery,
    opts?: { signal?: AbortSignal },
  ) => Promise<DriveFileNodeLocation>;
  readCachedPath: (nodeId: string) => Promise<string | undefined>;
  readCachedNodeId: (path: string) => Promise<string | undefined>;
  recordLocation: (nodeId: string, path: string) => Promise<void>;
  isOnline: () => boolean;
};

/** `missing`: the server says no such readable file. `unknown`: no server and no cache row. */
export type DocsLocateResult =
  { kind: "found"; id: string; path: string } | { kind: "missing" } | { kind: "unknown" };

export function createDocsLocatorDeps(username: string | null | undefined): DocsLocatorDeps {
  return {
    fetchLocation: fetchDriveFileNodeLocation,
    // Docs' own record comes straight from the server; the Drive crawl may be older.
    readCachedPath: async (nodeId) =>
      username
        ? ((await readDocsPathForNodeId(username, nodeId)) ??
          (await readCachedDrivePathForNodeId(username, nodeId)))
        : undefined,
    readCachedNodeId: async (path) =>
      username
        ? ((await readCachedDriveNodeId(username, path)) ??
          (await readDocsNodeIdForPath(username, path)))
        : undefined,
    recordLocation: (nodeId, path) =>
      username ? recordDocsNodePath(username, nodeId, path) : Promise.resolve(),
    isOnline: getConnectivitySnapshot,
  };
}

function isServerAnswer(error: unknown): error is WgwRequestError {
  return error instanceof WgwRequestError && (error.status === 403 || error.status === 404);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fromServer(
  query: DriveFileNodeLocateQuery,
  deps: DocsLocatorDeps,
  signal?: AbortSignal,
): Promise<DocsLocateResult | null> {
  if (!deps.isOnline()) return null;
  try {
    const location = await deps.fetchLocation(query, { signal });
    // Before the editor opens: its local database is chosen by this id.
    await deps.recordLocation(location.id, location.path).catch(() => {});
    return { kind: "found", id: location.id, path: location.path };
  } catch (error) {
    if (isAbort(error)) throw error;
    if (isServerAnswer(error)) return { kind: "missing" };
    // Network failure or a server error: fall back to the cache.
    return null;
  }
}

export async function locateDocsById(
  nodeId: string,
  deps: DocsLocatorDeps,
  signal?: AbortSignal,
): Promise<DocsLocateResult> {
  const server = await fromServer({ id: nodeId }, deps, signal);
  if (server) return server;
  const path = await deps.readCachedPath(nodeId);
  return path ? { kind: "found", id: nodeId, path } : { kind: "unknown" };
}

export async function locateDocsByPath(
  path: string,
  deps: DocsLocatorDeps,
  signal?: AbortSignal,
): Promise<DocsLocateResult> {
  const server = await fromServer({ path }, deps, signal);
  if (server) return server;
  const id = await deps.readCachedNodeId(path);
  return id ? { kind: "found", id, path } : { kind: "unknown" };
}

/**
 * Paths this tab already knows for an id, so swapping `?file=` for `?id=`
 * (or a rename inside Docs) does not flash a loading state.
 */
const knownPaths = new Map<string, string>();

export function rememberDocsLocation(nodeId: string, path: string): void {
  knownPaths.set(nodeId, path);
}

export function knownDocsPath(nodeId: string): string | undefined {
  return knownPaths.get(nodeId);
}

export function forgetDocsLocationsForTest(): void {
  knownPaths.clear();
}
