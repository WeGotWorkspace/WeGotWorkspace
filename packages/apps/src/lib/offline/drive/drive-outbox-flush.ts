import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { ensureTrashFolder } from "@/drive-core/src/drive-batch-utils";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  listOutboxMutationsForDomain,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { normalizeDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import {
  applyDriveSidecarPathMigration,
  nextPathAfterRename,
} from "@/lib/offline/shared/drive-sidecar-mutations";
import { writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import {
  legacyDriveOutboxUploadPath,
  migrateDriveOutboxUploads,
  readLegacyDriveOutboxUpload,
} from "@/lib/offline/drive/upload/drive-upload-outbox-migration";

/**
 * Drive mutations queued while offline. Uploads are not among them: files go
 * to the upload queue as `Blob`s (#1501); `op: "upload"` rows an earlier
 * version left here are moved into that queue (#1520).
 */
export type DriveOutboxPayload =
  | { op: "rename"; from: string; destination: string; to: string }
  | { op: "trash"; from: string; destination: string; to: string }
  | { op: "star"; path: string; starred: boolean };

export type DriveOutboxFlushResult = {
  flushed: number;
  failed: number;
  stateMismatches: string[];
};

function parsePayload(row: OfflineOutboxRow): DriveOutboxPayload | null {
  if (row.domain !== DRIVE_DOMAIN) return null;
  try {
    return JSON.parse(row.payload) as DriveOutboxPayload;
  } catch {
    return null;
  }
}

export async function flushDriveOutbox(username: string): Promise<DriveOutboxFlushResult> {
  const drive = createWgwDriveOperations("/");
  try {
    await migrateDriveOutboxUploads(username);
  } catch (error) {
    console.warn("[drive-outbox] moving old uploads into the queue failed", error);
  }
  const rows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
  let flushed = 0;
  let failed = 0;
  const stateMismatches: string[] = [];

  for (const row of rows) {
    // An old upload whose folder is not known yet: it stays until it moves to the queue.
    if (readLegacyDriveOutboxUpload(row)) continue;
    const payload = parsePayload(row);
    if (!payload) {
      await removeOutboxMutation(username, row.id);
      continue;
    }

    try {
      if (payload.op === "rename" || payload.op === "trash") {
        if (payload.op === "trash") {
          await ensureTrashFolder(drive, username, new Set());
        }
        await drive.renameItem({
          destination: payload.destination,
          from: payload.from,
          to: payload.to,
        });
        await applyDriveSidecarPathMigration(
          username,
          payload.from,
          payload.destination,
          payload.to,
        );
      } else if (payload.op === "star") {
        await drive.setStar({ path: payload.path, starred: payload.starred });
        const paths = await drive.listStars();
        await writeDocsStarredPaths(username, paths);
      }
      await removeOutboxMutation(username, row.id);
      flushed += 1;
    } catch (error) {
      failed += 1;
      const status = httpStatusFromFlushError(error);
      const message = error instanceof Error ? error.message : String(error);
      // Some Drive REST writes still throw an Error without a status, so the text is the
      // only sign of a 412 there. Drop the regex once they throw a typed error.
      const isStateMismatch =
        status === 409 ||
        status === 412 ||
        // eslint-disable-next-line no-restricted-syntax -- reviewed exception (#1642), see above
        /precondition failed/i.test(message);
      if (isStateMismatch) {
        const path = driveOutboxApiPath(row);
        if (path) stateMismatches.push(path);
      }
      await markOutboxError(username, row.id, message, status);
    }
  }

  return { flushed, failed, stateMismatches };
}

export function pathsForDriveOutboxPayload(payload: DriveOutboxPayload): string[] {
  switch (payload.op) {
    case "rename":
    case "trash":
      return [
        normalizeDriveAvailabilityPath(payload.from),
        normalizeDriveAvailabilityPath(
          nextPathAfterRename(payload.from, payload.destination, payload.to),
        ),
      ];
    case "star":
      return [normalizeDriveAvailabilityPath(payload.path)];
    default: {
      const unreachable: never = payload;
      return unreachable;
    }
  }
}

export function pathsForDriveOutboxRow(row: OfflineOutboxRow): string[] {
  const legacy = readLegacyDriveOutboxUpload(row);
  if (legacy) return [legacyDriveOutboxUploadPath(legacy)];
  const payload = parsePayload(row);
  if (!payload) return [];
  return pathsForDriveOutboxPayload(payload);
}

export function driveOutboxApiPath(row: OfflineOutboxRow): string | null {
  return pathsForDriveOutboxRow(row)[0] ?? null;
}

export async function removeOutboxMutationsForDrivePath(
  username: string,
  apiPath: string,
): Promise<void> {
  const normalized = normalizeDriveAvailabilityPath(apiPath);
  const rows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
  for (const row of rows) {
    const path = driveOutboxApiPath(row);
    if (path === normalized) {
      await removeOutboxMutation(username, row.id);
    }
  }
}

export { nextPathAfterRename };
