import { isMfaSetupRequiredError } from "@/lib/api/wgw/mfa-error";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { ensureTrashFolder } from "@/drive-core/src/drive-batch-utils";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
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

export type DriveOutboxPayload =
  | { op: "rename"; from: string; destination: string; to: string }
  | { op: "trash"; from: string; destination: string; to: string }
  | { op: "upload"; cwd: string; name: string; base64: string; mimeType: string }
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function flushDriveOutbox(username: string): Promise<DriveOutboxFlushResult> {
  const drive = createWgwDriveOperations("/");
  const rows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
  let flushed = 0;
  let failed = 0;
  const stateMismatches: string[] = [];

  for (const row of rows) {
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
      } else if (payload.op === "upload") {
        const parent = normalizeApiVirtualPath(payload.cwd);
        const blob = base64ToBlob(payload.base64, payload.mimeType);
        const file = new File([blob], payload.name, {
          type: payload.mimeType,
          lastModified: Date.now(),
        });
        await drive.uploadFiles({ cwd: parent, files: [file] });
      } else if (payload.op === "star") {
        await drive.setStar({ path: payload.path, starred: payload.starred });
        const paths = await drive.listStars();
        await writeDocsStarredPaths(username, paths);
      }
      await removeOutboxMutation(username, row.id);
      flushed += 1;
    } catch (error) {
      if (isMfaSetupRequiredError(error)) break;
      failed += 1;
      const status = (error as { status?: number } | undefined)?.status;
      const message = error instanceof Error ? error.message : String(error);
      const isStateMismatch =
        status === 409 || status === 412 || /precondition failed/i.test(message);
      if (isStateMismatch) {
        const path = driveOutboxApiPath(row);
        if (path) stateMismatches.push(path);
      }
      await markOutboxError(username, row.id, message);
    }
  }

  return { flushed, failed, stateMismatches };
}

export function driveOutboxApiPath(row: OfflineOutboxRow): string | null {
  const payload = parsePayload(row);
  if (!payload) return null;
  if (payload.op === "upload") {
    const parent = normalizeApiVirtualPath(payload.cwd);
    return normalizeDriveAvailabilityPath(
      parent === "/" ? `/${payload.name}` : `${parent}/${payload.name}`,
    );
  }
  if (payload.op === "star") return normalizeDriveAvailabilityPath(payload.path);
  return normalizeDriveAvailabilityPath(payload.from);
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

export async function encodeUploadFileForOutbox(file: File): Promise<{
  base64: string;
  mimeType: string;
}> {
  return {
    base64: await blobToBase64(file),
    mimeType: file.type || "application/octet-stream",
  };
}

export { nextPathAfterRename };
