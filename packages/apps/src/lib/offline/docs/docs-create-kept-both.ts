import { parentAndName } from "@/lib/files/api-path";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import { docsPathAfterMove, moveDocsPath } from "@/lib/offline/docs/docs-path-moves";
import { renameDocsListingResult } from "@/lib/offline/docs/docs-listing-offline-store";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";

/** An offline-created Doc whose name was taken on the server, and the path it got. */
export type DocsKeptBoth = { from: string; to: string };

/**
 * The offline-created Doc landed under another name (keep both, #1563). Move
 * what this device holds for it to that name: the listing row, the pin and
 * Drive sidecars, and the local text (an offline-created Doc has no FileNode
 * id yet, so its text sits in the path-keyed database). Then tell every tab,
 * so an editor that has it open follows the file.
 */
export async function moveKeptBothDocsCreate(username: string, move: DocsKeptBoth): Promise<void> {
  const { destination, from: name } = parentAndName(move.to);
  await renameDocsListingResult(username, move.from, move.to);
  await applyDriveSidecarPathMigration(username, move.from, destination, name);
  await moveDocsPath(username, move.from, move.to);
}

function retarget(path: string, from: string, to: string): string {
  const next = docsPathAfterMove(path, from, to);
  return next === null ? path : `/${next}`;
}

/** The same queued write, aimed at `to` where it named `from`. Unchanged when it did not. */
export function retargetDocsOutboxPayload(
  payload: DocsOutboxPayload,
  from: string,
  to: string,
): DocsOutboxPayload {
  switch (payload.op) {
    case "rename":
    case "trash": {
      const moved = retarget(payload.from, from, to);
      return moved === payload.from ? payload : { ...payload, from: moved };
    }
    case "create": {
      const moved = retarget(payload.apiPath, from, to);
      return moved === payload.apiPath ? payload : { ...payload, apiPath: moved };
    }
    case "star": {
      const moved = retarget(payload.path, from, to);
      return moved === payload.path ? payload : { ...payload, path: moved };
    }
    default:
      return payload;
  }
}
