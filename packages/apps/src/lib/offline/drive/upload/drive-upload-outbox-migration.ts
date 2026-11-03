import { normalizeApiVirtualPath } from "@/lib/files/api-path";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { normalizeDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { notifyDriveUploadQueueChanged } from "@/lib/offline/drive/upload/drive-upload-events";
import { buildUploadPlaceholderRows } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
  type DriveUploadTargetFolder,
  type OfflineDriveUploadBatchRow,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { newDriveUploadItem } from "@/lib/offline/drive/upload/drive-upload-store";
import { resolveDriveUploadTarget } from "@/lib/offline/drive/upload/drive-upload-target";

/**
 * An offline upload as earlier versions stored it in the Drive outbox: the
 * whole file base64-encoded in a JSON string. Nothing writes these anymore;
 * they are only read here, to move them into the upload queue (#1520).
 */
export type LegacyDriveOutboxUpload = {
  op: "upload";
  cwd: string;
  name: string;
  base64: string;
  mimeType: string;
};

export function readLegacyDriveOutboxUpload(row: OfflineOutboxRow): LegacyDriveOutboxUpload | null {
  if (row.domain !== DRIVE_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as Partial<LegacyDriveOutboxUpload>;
    if (payload.op !== "upload") return null;
    if (typeof payload.cwd !== "string" || typeof payload.name !== "string") return null;
    if (typeof payload.base64 !== "string") return null;
    return {
      op: "upload",
      cwd: payload.cwd,
      name: payload.name,
      base64: payload.base64,
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "",
    };
  } catch {
    return null;
  }
}

/** The path a legacy row protects from pruning until it is moved into the queue. */
export function legacyDriveOutboxUploadPath(payload: LegacyDriveOutboxUpload): string {
  const parent = normalizeApiVirtualPath(payload.cwd);
  return normalizeDriveAvailabilityPath(
    parent === "/" ? `/${payload.name}` : `${parent}/${payload.name}`,
  );
}

/** Decoding only: the stored base64 back into bytes, once, for the queue. */
function decodeLegacyBytes(payload: LegacyDriveOutboxUpload): File {
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const type = payload.mimeType || "application/octet-stream";
  return new File([bytes], payload.name, { type, lastModified: Date.now() });
}

type LegacyRow = { row: OfflineOutboxRow; payload: LegacyDriveOutboxUpload };

/**
 * One released batch per folder, in one transaction with the removal of its
 * outbox rows: either the files are in the queue (with their `Blob`s and
 * placeholders, which keep the prune protection the rows gave) or the rows
 * are still in the outbox. A row another tab already moved is skipped.
 */
async function moveIntoQueue(
  username: string,
  folderPath: string,
  targetFolder: DriveUploadTargetFolder,
  legacy: readonly LegacyRow[],
): Promise<number> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const batches = driveUploadBatchesTable(db);
  const items = driveUploadItemsTable(db);
  const blobs = driveUploadBlobsTable(db);
  const entries = driveEntriesTable(db);
  const files = legacy.map(({ payload }) => decodeLegacyBytes(payload));
  return db.transaction("rw", [batches, items, blobs, entries, db.outbox], async () => {
    const stillQueued = await db.outbox.bulkGet(legacy.map(({ row }) => row.id));
    const present = legacy
      .map((entry, index) => ({ ...entry, file: files[index]! }))
      .filter((_, index) => stillQueued[index]);
    if (present.length === 0) return 0;
    const batch: OfflineDriveUploadBatchRow = {
      id: crypto.randomUUID(),
      // No dialog: the old outbox never asked either. A name conflict keeps both, with a notice.
      status: "released",
      keepOffline: "remove",
      targetFolder,
      createdAt: present[0]!.row.createdAt,
      notices: [],
    };
    await batches.put(batch);
    for (const { row, file } of present) {
      const item = newDriveUploadItem(batch, file, row.createdAt, true);
      await items.put(item);
      await blobs.put({ id: item.id, blob: file });
      await entries.put(buildUploadPlaceholderRows(folderPath, [item])[0]!);
    }
    await db.outbox.bulkDelete(present.map(({ row }) => row.id));
    return present.length;
  });
}

/**
 * Moves the outbox `op: "upload"` rows of earlier versions into the upload
 * queue, one released batch per folder. Rows whose folder id is not known on
 * this device while offline stay in the outbox (still protected from
 * pruning) and are moved on a later run. `waiting` counts those.
 */
export async function migrateDriveOutboxUploads(
  username: string,
): Promise<{ moved: number; waiting: number }> {
  const rows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
  const byFolder = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const payload = readLegacyDriveOutboxUpload(row);
    if (!payload) continue;
    const folder = normalizeApiVirtualPath(payload.cwd);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), { row, payload }]);
  }
  let moved = 0;
  let waiting = 0;
  for (const [folderPath, legacy] of byFolder) {
    let targetFolder: DriveUploadTargetFolder;
    try {
      targetFolder = await resolveDriveUploadTarget(username, folderPath);
    } catch (error) {
      console.warn("[drive-upload] outbox upload waits for its folder", error);
      waiting += legacy.length;
      continue;
    }
    try {
      moved += await moveIntoQueue(username, folderPath, targetFolder, legacy);
    } catch (error) {
      // The rows stay in the outbox; the folders after this one still move.
      console.warn("[drive-upload] outbox upload could not move into the queue", error);
      waiting += legacy.length;
    }
  }
  if (moved > 0) notifyDriveUploadQueueChanged(username);
  return { moved, waiting };
}
