import {
  fetchDriveFileNodeLocation,
  type DriveFileNodeLocateQuery,
  type DriveFileNodeLocation,
} from "@/lib/api/wgw/drive-node-locate";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  readCachedDriveNodeId,
  readCachedDrivePathForNodeId,
} from "@/lib/offline/drive/drive-directory-offline-store";

/**
 * Finds a Doc by FileNode id, or a Doc's id by path (#1751).
 *
 * Network first: the server knows where a file lives now, and a cached
 * path → id row can be stale once another file took the old path. The offline
 * Drive cache answers only when the request cannot reach the server.
 */
export type DocsLocatorDeps = {
  fetchLocation: (
    query: DriveFileNodeLocateQuery,
    opts?: { signal?: AbortSignal },
  ) => Promise<DriveFileNodeLocation>;
  readCachedPath: (nodeId: string) => Promise<string | undefined>;
  readCachedNodeId: (path: string) => Promise<string | undefined>;
  isOnline: () => boolean;
};

/** `missing`: the server says no such readable file. `unknown`: no server and no cache row. */
export type DocsLocateResult =
  { kind: "found"; id: string; path: string } | { kind: "missing" } | { kind: "unknown" };

export function createDocsLocatorDeps(username: string | null | undefined): DocsLocatorDeps {
  return {
    fetchLocation: fetchDriveFileNodeLocation,
    readCachedPath: (nodeId) =>
      username ? readCachedDrivePathForNodeId(username, nodeId) : Promise.resolve(undefined),
    readCachedNodeId: (path) =>
      username ? readCachedDriveNodeId(username, path) : Promise.resolve(undefined),
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
