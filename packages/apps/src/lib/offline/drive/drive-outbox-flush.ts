import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { ensureTrashFolder } from "@/lib/files/drive-entry-names";
import { parseOutboxPayload, runOutboxFlush } from "@/lib/offline/core/outbox-flush";
import {
  listOutboxMutationsForDomain,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { normalizeDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import {
  applyDriveSidecarPathMigration,
  nextPathAfterRename,
} from "@/lib/offline/shared/drive-sidecar-mutations";
import { isDriveOutboxStateMismatch } from "@/lib/offline/shared/drive-outbox-state-mismatch";
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
  return parseOutboxPayload<DriveOutboxPayload>(row, DRIVE_DOMAIN);
}

export async function flushDriveOutbox(username: string): Promise<DriveOutboxFlushResult> {
  const drive = createWgwDriveOperations("/");
  try {
    await migrateDriveOutboxUploads(username);
  } catch (error) {
    console.warn("[drive-outbox] moving old uploads into the queue failed", error);
  }
  const stateMismatches: string[] = [];

  const counts = await runOutboxFlush<DriveOutboxPayload>(username, {
    domain: DRIVE_DOMAIN,
    // An old upload whose folder is not known yet: it stays until it moves to the queue.
    prepare: async (row) => (readLegacyDriveOutboxUpload(row) ? null : row),
    parse: parsePayload,
    send: async (payload) => {
      if (payload.op === "rename" || payload.op === "trash") {
        if (payload.op === "trash") {
          await ensureTrashFolder(drive, username, new Set());
        }
        await drive.renameItem({
          destination: payload.destination,
          from: payload.from,
          to: payload.to,
        });
        // Page setup moved when the rename or trash was queued.
        await applyDriveSidecarPathMigration(
          username,
          payload.from,
          payload.destination,
          payload.to,
          { movePageSetup: false },
        );
      } else if (payload.op === "star") {
        await drive.setStar({ path: payload.path, starred: payload.starred });
        const paths = await drive.listStars();
        await writeDocsStarredPaths(username, paths);
      }
    },
    onFailure: (failure) => {
      if (!isDriveOutboxStateMismatch(failure)) return;
      const path = driveOutboxApiPath(failure.row);
      if (path) stateMismatches.push(path);
    },
  });

  return { ...counts, stateMismatches };
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
