import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

/** The server writes every zip: offline there is nothing to save (#1621, #1905). */
export const ZIP_NEEDS_CONNECTION = "Downloading a folder as a zip needs a connection.";

type DownloadOpts = { signal?: AbortSignal };

/** The zip downloads of the live Drive operations (kept here so src/lib does not import drive-core). */
type LiveZipDownloads = {
  downloadFolder?: (path: string, opts?: DownloadOpts) => Promise<void>;
  downloadSelection?: (paths: string[], name: string, opts?: DownloadOpts) => Promise<void>;
};

/** Folder download for a hybrid: the live zip, or {@link ZIP_NEEDS_CONNECTION} offline. */
export function onlineOnlyDownloadFolder(
  live: LiveZipDownloads,
): NonNullable<LiveZipDownloads["downloadFolder"]> {
  return async (path, opts) => {
    if (!readBrowserOnline() || !live.downloadFolder) {
      throw new Error(ZIP_NEEDS_CONNECTION);
    }
    await live.downloadFolder(normalizeApiVirtualPath(path), opts);
  };
}

/** Multi-item download for a hybrid: the live zip, or {@link ZIP_NEEDS_CONNECTION} offline. */
export function onlineOnlyDownloadSelection(
  live: LiveZipDownloads,
): NonNullable<LiveZipDownloads["downloadSelection"]> {
  return async (paths, name, opts) => {
    if (!readBrowserOnline() || !live.downloadSelection) {
      throw new Error(ZIP_NEEDS_CONNECTION);
    }
    await live.downloadSelection(paths.map(normalizeApiVirtualPath), name, opts);
  };
}
