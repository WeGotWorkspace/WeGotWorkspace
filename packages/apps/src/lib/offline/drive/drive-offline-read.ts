import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { readDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { driveContentBlobsTable } from "@/lib/offline/drive/drive-schema";
import { readOfflineDocsFileBlob } from "@/lib/offline/docs/docs-offline-download";
import { hasDocsCollabOfflinePersistence } from "@/lib/offline/docs/docs-collab-offline-availability";

export async function readOfflineDriveFileBlob(
  username: string,
  apiPath: string,
): Promise<Blob | null> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalized.replace(/^\/+/, "");

  if (isDocsCollabEditablePath(room)) {
    return readOfflineDocsFileBlob(username, normalized);
  }

  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await driveContentBlobsTable(db).get(room);
  return row?.blob ?? null;
}

export async function hasOfflineDriveFileContent(
  username: string,
  apiPath: string,
): Promise<boolean> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalized.replace(/^\/+/, "");
  if (isDocsCollabEditablePath(room)) {
    return hasDocsCollabOfflinePersistence(room);
  }
  const blob = await readOfflineDriveFileBlob(username, normalized);
  return blob != null;
}

export async function isManualOfflineDrivePin(username: string, apiPath: string): Promise<boolean> {
  const row = await readDriveAvailability(username, apiPath);
  return row?.source === "manual";
}

export { triggerBrowserBlobDownload } from "@/lib/offline/docs/docs-offline-download";

export async function downloadOfflineDriveFile(username: string, apiPath: string): Promise<void> {
  const { triggerBrowserBlobDownload } = await import("@/lib/offline/docs/docs-offline-download");
  const blob = await readOfflineDriveFileBlob(username, apiPath);
  if (!blob) {
    throw new Error("This file is not available offline.");
  }
  const filename = normalizeApiVirtualPath(apiPath).split("/").pop() || "download";
  triggerBrowserBlobDownload(blob, filename);
}
