import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import {
  markDocsAvailabilitySynced,
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import {
  createHybridDocsDriveOperations,
  parentAndName,
} from "@/lib/offline/docs/docs-hybrid-operations";
import {
  hydrateDocsCollabForOffline,
  seedEmptyDocsCollabOffline,
} from "@/lib/offline/docs/docs-pin-hydrate";
import { clearDocsCollabOfflinePersistence } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { upsertDocsListingResult } from "@/lib/offline/docs-listing-offline-store";
import { readCachedDriveNodeId } from "@/lib/offline/drive/drive-directory-offline-store";

export async function makeDocsOfflineAvailable(
  username: string,
  apiPath: string,
  location: string,
): Promise<void> {
  const room = apiPath.trim().replace(/^\/+/, "");
  if (!isDocsCollabEditablePath(room)) {
    throw new Error("Only editable text files can be made available offline.");
  }
  await hydrateDocsCollabForOffline({ apiPath: room });
  const nodeId = await readCachedDriveNodeId(username, room);
  await writeDocsAvailability(username, { id: room, location, nodeId });
  await markDocsAvailabilitySynced(username, room);
}

export async function removeDocsOfflineCopy(username: string, apiPath: string): Promise<void> {
  const room = apiPath.trim().replace(/^\/+/, "");
  await clearDocsCollabOfflinePersistence(room);
  await removeDocsAvailability(username, room);
}

/** Queue a new empty document for offline create and seed local collab state. */
export async function queueNewDocsOfflineDocument(
  username: string,
  apiPath: string,
  location = "",
): Promise<void> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalizeDocsAvailabilityPath(normalized);
  const { destination, from } = parentAndName(normalized);
  const lower = from.toLowerCase();
  const mime = lower.endsWith(".txt") ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
  const file = new File([new Blob([""], { type: mime })], from, {
    type: lower.endsWith(".txt") ? "text/plain" : "text/markdown",
    lastModified: Date.now(),
  });
  const hybrid = createHybridDocsDriveOperations(username);
  await hybrid.uploadFiles({ cwd: destination, files: [file] });
  await upsertDocsListingResult(username, normalized);
  if (isDocsCollabEditablePath(room)) {
    await seedEmptyDocsCollabOffline(room);
    await writeDocsAvailability(username, { id: room, location });
    await markDocsAvailabilitySynced(username, room);
  }
}
