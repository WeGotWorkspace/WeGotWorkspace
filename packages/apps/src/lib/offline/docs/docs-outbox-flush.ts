import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { ensureTrashFolder } from "@/drive-core/src/drive-batch-utils";
import { parentAndName } from "@/lib/files/api-path";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import {
  listOutboxMutationsForDomain,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  migrateDocsAvailabilityPath,
  normalizeDocsAvailabilityPath,
} from "@/lib/offline/docs/docs-availability-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { migrateCollabPersistence } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";

export type DocsOutboxPayload =
  | { op: "rename"; from: string; destination: string; to: string }
  | { op: "trash"; from: string; destination: string; to: string }
  | { op: "create"; apiPath: string; content: string }
  | { op: "star"; path: string; starred: boolean };

export type OutboxFlushResult = {
  flushed: number;
  failed: number;
  stateMismatches: string[];
};

function parsePayload(row: OfflineOutboxRow): DocsOutboxPayload | null {
  if (row.domain !== DOCS_DOMAIN) return null;
  try {
    return JSON.parse(row.payload) as DocsOutboxPayload;
  } catch {
    return null;
  }
}

function nextPathAfterRename(from: string, destination: string, to: string): string {
  const normalizedDest = normalizeApiVirtualPath(destination);
  return normalizedDest === "/" ? `/${to}` : `${normalizedDest}/${to}`;
}

async function applyRenameSideEffects(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  const oldPath = normalizeDocsAvailabilityPath(from);
  const newPath = normalizeDocsAvailabilityPath(nextPathAfterRename(from, destination, to));
  if (isDocsCollabEditablePath(oldPath) && isDocsCollabEditablePath(newPath)) {
    try {
      await migrateCollabPersistence(oldPath, newPath);
    } catch (error) {
      console.warn("[docs-offline] collab persistence migration failed", error);
    }
  }
  await migrateDocsAvailabilityPath(username, oldPath, newPath);
}

export async function flushDocsOutbox(username: string): Promise<OutboxFlushResult> {
  const drive = createWgwDriveOperations("/");
  const rows = await listOutboxMutationsForDomain(username, DOCS_DOMAIN);
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
        await applyRenameSideEffects(username, payload.from, payload.destination, payload.to);
      } else if (payload.op === "create") {
        const { destination, from } = parentAndName(payload.apiPath);
        const lower = from.toLowerCase();
        const mime = lower.endsWith(".txt")
          ? "text/plain;charset=utf-8"
          : "text/markdown;charset=utf-8";
        const blob = new Blob([payload.content], { type: mime });
        const file = new File([blob], from, {
          type: lower.endsWith(".txt") ? "text/plain" : "text/markdown",
          lastModified: Date.now(),
        });
        await drive.uploadFiles({ cwd: destination, files: [file] });
      } else if (payload.op === "star") {
        await drive.setStar({ path: payload.path, starred: payload.starred });
      }
      await removeOutboxMutation(username, row.id);
      flushed += 1;
    } catch (error) {
      failed += 1;
      const status = (error as { status?: number } | undefined)?.status;
      const message = error instanceof Error ? error.message : String(error);
      const isStateMismatch =
        status === 409 || status === 412 || /precondition failed/i.test(message);
      if (isStateMismatch) {
        const path = docsOutboxApiPath(row);
        if (path) stateMismatches.push(path);
      }
      await markOutboxError(username, row.id, message);
    }
  }

  return { flushed, failed, stateMismatches };
}

export function docsOutboxApiPath(row: OfflineOutboxRow): string | null {
  const payload = parsePayload(row);
  if (!payload) return null;
  if (payload.op === "create") return normalizeDocsAvailabilityPath(payload.apiPath);
  if (payload.op === "star") return normalizeDocsAvailabilityPath(payload.path);
  return normalizeDocsAvailabilityPath(payload.from);
}

/**
 * Drop queued docs mutations for a path (e.g. cancel a pending create before trash).
 * Returns whether a queued trash op was among them. That trash never reached the server.
 */
export async function removeOutboxMutationsForDocsPath(
  username: string,
  apiPath: string,
): Promise<boolean> {
  const normalized = normalizeDocsAvailabilityPath(apiPath);
  const rows = await listOutboxMutationsForDomain(username, DOCS_DOMAIN);
  let removedTrash = false;
  for (const row of rows) {
    const path = docsOutboxApiPath(row);
    if (path !== normalized) continue;
    if (parsePayload(row)?.op === "trash") removedTrash = true;
    await removeOutboxMutation(username, row.id);
  }
  return removedTrash;
}
