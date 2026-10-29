import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import type {
  DriveFileNodeLocation,
  DriveFileNodeLocationDataResponse,
} from "@wgw/openapi-types/drive-types";

export type { DriveFileNodeLocation };

export type DriveFileNodeLocateQuery = { id: string } | { path: string };

/**
 * `GET /files/node`: FileNode id ↔ current path for a file the caller may read (#1751).
 * Throws `WgwRequestError` with the HTTP status (403, 404, …). A fetch that never
 * reached the server rejects with the browser's network error.
 */
export async function fetchDriveFileNodeLocation(
  query: DriveFileNodeLocateQuery,
  opts?: { signal?: AbortSignal },
): Promise<DriveFileNodeLocation> {
  const search =
    "id" in query
      ? `id=${encodeURIComponent(query.id)}`
      : `path=${encodeURIComponent(normalizeApiVirtualPath(query.path))}`;
  const path = `/files/node?${search}`;
  const res = await wgwFetch(path, { signal: opts?.signal });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new WgwRequestError(`GET ${path} failed (${res.status}): ${detail}`, res.status);
  }
  const payload = (await wgwReadJson(res)) as DriveFileNodeLocationDataResponse;
  return payload.data;
}
