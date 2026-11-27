import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import { JmapMethodError } from "@/lib/jmap-client";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

/** Meta key for the FileNode/changes `sinceState`. One token per account. */
export const DRIVE_FILE_NODE_SYNC_TOKEN_KEY = "drive:file-node-sync-state";

/** Safety cap on `hasMoreChanges` follow-ups inside one sync. Same bound as `JmapChatAdapter`. */
export const DRIVE_INBOUND_MAX_CHANGE_PAGES = 20;

export type DrainedFileNodeChanges = {
  created: string[];
  updated: string[];
  destroyed: string[];
  newState: string;
};

export async function readDriveSyncToken(username: string): Promise<string | null> {
  return readMeta(username, DRIVE_FILE_NODE_SYNC_TOKEN_KEY);
}

export async function writeDriveSyncToken(username: string, token: string): Promise<void> {
  await writeMeta(username, DRIVE_FILE_NODE_SYNC_TOKEN_KEY, token);
}

export function isCannotCalculateChanges(error: unknown): boolean {
  return error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges";
}

/**
 * Follows `hasMoreChanges` the way `JmapChatAdapter` does. The token is the
 * last page actually read. Hitting the cap leaves the remainder for the next
 * sync instead of skipping it. `beforeRequest` runs before every page (the
 * tree sync paces its catch-up with it).
 */
export async function drainFileNodeChanges(
  session: Pick<DriveJmapSession, "fileNodes" | "accountId">,
  since: string,
  signal?: AbortSignal,
  beforeRequest?: () => Promise<void>,
): Promise<DrainedFileNodeChanges> {
  const created = new Set<string>();
  const updated = new Set<string>();
  const destroyed = new Set<string>();
  let sinceState = since;
  let newState = since;
  for (let page = 0; page < DRIVE_INBOUND_MAX_CHANGE_PAGES; page += 1) {
    await beforeRequest?.();
    const changes = await session.fileNodes.fileNodeChanges(session.accountId, sinceState, {
      signal,
    });
    for (const id of changes.created) created.add(id);
    for (const id of changes.updated) updated.add(id);
    for (const id of changes.destroyed) destroyed.add(id);
    newState = changes.newState;
    sinceState = changes.newState;
    if (!changes.hasMoreChanges) break;
    if (page === DRIVE_INBOUND_MAX_CHANGE_PAGES - 1) {
      console.warn("[drive-inbound] FileNode/changes still has more pages after the safety cap", {
        pages: DRIVE_INBOUND_MAX_CHANGE_PAGES,
      });
    }
  }
  return {
    created: [...created],
    updated: [...updated],
    destroyed: [...destroyed],
    newState,
  };
}
