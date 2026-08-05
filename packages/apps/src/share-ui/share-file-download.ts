import {
  wgwApiBaseUrl,
  wgwEnsureFreshAccessToken,
  wgwErrorMessageFromBody,
} from "@/lib/api/wgw/http";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { triggerBrowserBlobDownload } from "@/lib/offline/docs/docs-offline-download";

export async function downloadSharedDriveFile(
  apiPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const token = await wgwEnsureFreshAccessToken();
  if (!token) {
    throw new Error("Share session expired. Open the link again.");
  }

  const base = wgwApiBaseUrl();
  const res = await fetch(`${base}/files/content?path=${encodeURIComponent(normalized)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(wgwErrorMessageFromBody(body, res.status, res.statusText));
  }

  const blob = await res.blob();
  const filename = normalized.split("/").filter(Boolean).at(-1) ?? "download";
  triggerBrowserBlobDownload(blob, filename);
}
