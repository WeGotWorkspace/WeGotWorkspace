import { wgwFetch } from "@/lib/api/wgw/http";

export type DocsImageContentFetcher = (nodeId: string, signal?: AbortSignal) => Promise<Blob>;

/** Authenticated content-by-id read (Chunk A). Session bearer, not cookies. */
export async function fetchDocsImageContentByNodeId(
  nodeId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await wgwFetch(`/files/content?id=${encodeURIComponent(nodeId)}`, { signal });
  if (!res.ok) {
    throw new Error(`GET /files/content failed (${res.status})`);
  }
  return res.blob();
}
