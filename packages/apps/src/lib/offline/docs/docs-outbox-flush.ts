import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { createDriveFileKeepingBoth } from "@/lib/api/wgw/drive-create-keep-both";
import { ensureTrashFolder } from "@/lib/files/drive-entry-names";
import { moveDocsPageSetupOverride } from "@/lib/docs-page-setup";
import { parentAndName } from "@/lib/files/api-path";
import { parseOutboxPayload, runOutboxFlush } from "@/lib/offline/core/outbox-flush";
import {
  listOutboxMutationsForDomain,
  putOutboxMutation,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { normalizeDocsAvailabilityPath } from "@/lib/offline/docs/docs-availability-store";
import {
  applyDriveSidecarPathMigration,
  nextPathAfterRename,
} from "@/lib/offline/shared/drive-sidecar-mutations";
import { isDriveOutboxStateMismatch } from "@/lib/offline/shared/drive-outbox-state-mismatch";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  moveKeptBothDocsCreate,
  retargetDocsOutboxPayload,
  type DocsKeptBoth,
} from "@/lib/offline/docs/docs-create-kept-both";

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
  return parseOutboxPayload<DocsOutboxPayload>(row, DOCS_DOMAIN);
}

async function applyRenameSideEffects(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  // Page setup moved when the rename or trash was queued.
  await applyDriveSidecarPathMigration(username, from, destination, to, { movePageSetup: false });
}

export async function flushDocsOutbox(username: string): Promise<OutboxFlushResult> {
  const drive = createWgwDriveOperations("/");
  const stateMismatches: string[] = [];
  const keptBoth: DocsKeptBoth[] = [];

  const counts = await runOutboxFlush<DocsOutboxPayload>(username, {
    domain: DOCS_DOMAIN,
    // A later write on a kept-both create's path follows it to the name it got.
    prepare: async (queued) => {
      const row = retargetQueuedRow(queued, keptBoth);
      if (row !== queued) await putOutboxMutation(username, row);
      return row;
    },
    parse: parsePayload,
    send: async (payload, row) => {
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
        // A name taken on the server meanwhile keeps both: that file is never replaced.
        const { destination, from } = parentAndName(payload.apiPath);
        const name = await createDriveFileKeepingBoth(destination, docsCreateFile(payload), {
          mayHaveLanded: row.retries > 0,
        });
        if (name !== from) {
          const move = {
            from: payload.apiPath,
            to: nextPathAfterRename(payload.apiPath, destination, name),
          };
          await moveKeptBothDocsCreate(username, move);
          keptBoth.push(move);
        }
      } else if (payload.op === "star") {
        await drive.setStar({ path: payload.path, starred: payload.starred });
      }
    },
    onFailure: (failure) => {
      if (!isDriveOutboxStateMismatch(failure)) return;
      const path = docsOutboxApiPath(failure.row);
      if (path) stateMismatches.push(path);
    },
  });

  return { ...counts, stateMismatches };
}

function docsCreateFile(payload: Extract<DocsOutboxPayload, { op: "create" }>): File {
  const { from } = parentAndName(payload.apiPath);
  const isText = from.toLowerCase().endsWith(".txt");
  const blob = new Blob([payload.content], {
    type: isText ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8",
  });
  return new File([blob], from, {
    type: isText ? "text/plain" : "text/markdown",
    lastModified: Date.now(),
  });
}

function retargetQueuedRow(
  row: OfflineOutboxRow,
  keptBoth: readonly DocsKeptBoth[],
): OfflineOutboxRow {
  const payload = keptBoth.length > 0 ? parsePayload(row) : null;
  if (!payload) return row;
  let next = payload;
  for (const move of keptBoth) next = retargetDocsOutboxPayload(next, move.from, move.to);
  return next === payload ? row : { ...row, payload: JSON.stringify(next) };
}

export function pathsForDocsOutboxPayload(payload: DocsOutboxPayload): string[] {
  switch (payload.op) {
    case "rename":
    case "trash":
      return [
        normalizeDocsAvailabilityPath(payload.from),
        normalizeDocsAvailabilityPath(
          nextPathAfterRename(payload.from, payload.destination, payload.to),
        ),
      ];
    case "create":
      return [normalizeDocsAvailabilityPath(payload.apiPath)];
    case "star":
      return [normalizeDocsAvailabilityPath(payload.path)];
    default: {
      const unreachable: never = payload;
      return unreachable;
    }
  }
}

export function pathsForDocsOutboxRow(row: OfflineOutboxRow): string[] {
  const payload = parsePayload(row);
  if (!payload) return [];
  return pathsForDocsOutboxPayload(payload);
}

export function docsOutboxApiPath(row: OfflineOutboxRow): string | null {
  return pathsForDocsOutboxRow(row)[0] ?? null;
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
    const payload = parsePayload(row);
    if (payload?.op === "trash") {
      removedTrash = true;
      // The offline trash moved the page setup under the trash path; put it back.
      moveDocsPageSetupOverride(
        nextPathAfterRename(payload.from, payload.destination, payload.to),
        payload.from,
      );
    }
    await removeOutboxMutation(username, row.id);
  }
  return removedTrash;
}
