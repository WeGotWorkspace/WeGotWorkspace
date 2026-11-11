import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import {
  removeDriveContentBlob,
  syncDriveFileContent,
} from "@/lib/offline/drive/drive-content-sync";
import { removeDocsOfflineCopy } from "@/lib/offline/docs/docs-offline-pin-core";

export async function makeDriveOfflineAvailable(username: string, apiPath: string): Promise<void> {
  if (!getConnectivitySnapshot()) {
    throw new Error("Connect to the network to make files available offline.");
  }
  await syncDriveFileContent(username, apiPath, { source: "manual" });
}

export async function removeDriveOfflineCopy(username: string, apiPath: string): Promise<void> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalized.replace(/^\/+/, "");
  if (isDocsCollabEditablePath(room)) {
    await removeDocsOfflineCopy(username, normalized);
  } else {
    await removeDriveContentBlob(username, normalized);
  }
  await removeDriveAvailability(username, room);
}
