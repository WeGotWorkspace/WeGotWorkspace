import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { hasDocsCollabOfflinePersistence } from "@/lib/offline/docs/docs-collab-offline-availability";
import {
  hasOfflineDriveFileContent,
  isManualOfflineDrivePin,
  readOfflineDriveFileBlob,
} from "@/lib/offline/drive/drive-offline-read";

export async function hasOfflineFileContent(username: string, apiPath: string): Promise<boolean> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalized.replace(/^\/+/, "");
  if (isDocsCollabEditablePath(room)) {
    return hasDocsCollabOfflinePersistence(room);
  }
  return hasOfflineDriveFileContent(username, normalized);
}

export async function isManualOfflinePin(username: string, apiPath: string): Promise<boolean> {
  return isManualOfflineDrivePin(username, apiPath);
}

export { readOfflineDriveFileBlob as readOfflineFileBlob };
