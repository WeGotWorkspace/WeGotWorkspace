import { readLastKnownDriveSession } from "@/lib/api/wgw/drive-upload-capabilities";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { findUploadPlaceholder } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadItemsTable,
  type DriveUploadConflictChoice,
  type DriveUploadReplaceTarget,
} from "@/lib/offline/drive/upload/drive-upload-schema";

/** A queued file whose name already exists in the target folder (per the known listing). */
export type DriveUploadConflict = {
  itemId: string;
  name: string;
  existing: {
    nodeId?: string;
    blobId?: string;
    /** The server is still hashing it (it arrived outside WGW): no *Replace*. */
    hashPending: boolean;
  };
};

export type DriveUploadBatchConflicts = {
  conflicts: DriveUploadConflict[];
  /** What the batch dialog may offer, in this order. Empty when there is no conflict. */
  choices: DriveUploadConflictChoice[];
  /** For `releaseDriveUploadBatch` when the user picks *Replace*. */
  replaceTargets: Record<string, DriveUploadReplaceTarget>;
};

/**
 * Whether *Replace* may be offered. Only when the Session advertises the
 * version check (`sessionVersionCheck`; null = no Session known, as offline
 * on a device that never saw one), and never for a file whose hash is still
 * pending or whose version the listing does not carry.
 */
export function driveUploadReplaceOffered(
  sessionVersionCheck: boolean | null,
  conflicts: readonly Pick<DriveUploadConflict, "existing">[],
): boolean {
  if (!sessionVersionCheck || conflicts.length === 0) return false;
  return conflicts.every(
    ({ existing }) => !existing.hashPending && Boolean(existing.nodeId && existing.blobId),
  );
}

/**
 * The Session's version check for the replace decision: the live Session
 * when one is at hand, else the last one this device saw (offline).
 */
export function driveUploadSessionVersionCheck(
  username: string,
  live: { versionCheck: boolean } | null,
): boolean | null {
  if (live) return live.versionCheck;
  return readLastKnownDriveSession(username)?.versionCheck ?? null;
}

/**
 * The batch's name conflicts against the cached listing of each item's
 * target folder, with the choices the dialog (#1521) may offer.
 */
export async function describeDriveUploadBatchConflicts(
  username: string,
  batchId: string,
  sessionVersionCheck: boolean | null,
): Promise<DriveUploadBatchConflicts> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const items = await driveUploadItemsTable(db)
    .where("batchId")
    .equals(batchId)
    .sortBy("createdAt");
  const listings = new Map<string, WgwDriveDirectoryEntry[]>();
  const conflicts: DriveUploadConflict[] = [];
  for (const item of items) {
    const placeholder = await findUploadPlaceholder(username, item.id);
    if (!placeholder) continue;
    let listing = listings.get(placeholder.parentPath);
    if (!listing) {
      listing = (await readDirectoryEntriesFromCache(username, placeholder.parentPath)).filter(
        (entry) => !entry.upload,
      );
      listings.set(placeholder.parentPath, listing);
    }
    const existing = listing.find(
      (entry) => entry.type !== "dir" && entry.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (!existing) continue;
    conflicts.push({
      itemId: item.id,
      name: item.name,
      existing: {
        ...(existing.nodeId ? { nodeId: existing.nodeId } : {}),
        ...(existing.blobId ? { blobId: existing.blobId } : {}),
        hashPending: existing.contentHashPending === true,
      },
    });
  }
  const replace = driveUploadReplaceOffered(sessionVersionCheck, conflicts);
  const choices: DriveUploadConflictChoice[] =
    conflicts.length === 0
      ? []
      : replace
        ? ["replace", "keep_both", "skip"]
        : ["keep_both", "skip"];
  const replaceTargets: Record<string, DriveUploadReplaceTarget> = {};
  if (replace) {
    for (const conflict of conflicts) {
      replaceTargets[conflict.itemId] = {
        nodeId: conflict.existing.nodeId!,
        blobId: conflict.existing.blobId!,
      };
    }
  }
  return { conflicts, choices, replaceTargets };
}
