import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import {
  readDriveSyncToken,
  settleDriveInbound,
  syncDriveInboundFromFileNodes,
  type DriveInboundSyncResult,
} from "@/lib/offline/drive/drive-inbound-sync";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";

const topic = cacheChangedTopic(DRIVE_DOMAIN);
const localListeners = new Set<{ username: string; onChange: () => void }>();

/**
 * Tell every tab of this browser, this one included, that another user's
 * change reached the Drive cache, so open listings fetch their folder again.
 * The tabs share one `FileNode/changes` token: a tab that did not pull would
 * otherwise see an equal state and keep its old listing.
 */
export function notifyDriveRemoteChange(username: string): void {
  for (const listener of localListeners) {
    if (listener.username === username) listener.onChange();
  }
  topic.notifyOtherTabs(username);
}

/** Hear {@link notifyDriveRemoteChange} for `username`, from any tab. */
export function subscribeDriveRemoteChanges(username: string, onChange: () => void): () => void {
  if (!username) return () => undefined;
  const local = { username, onChange };
  localListeners.add(local);
  const offOtherTabs = topic.subscribe(username, onChange);
  return () => {
    localListeners.delete(local);
    offOtherTabs();
  };
}

/**
 * True while Drive writes wait in the outbox. Their rows are only in the
 * cache and the listing, not on the server yet, so a refresh keeps them.
 * An unreadable cache counts as pending: keeping a row beats dropping one.
 */
export async function driveOutboxHasPending(username: string): Promise<boolean> {
  const rows = await guardOfflineCacheStep(
    listOutboxMutationsForDomain(username, DRIVE_DOMAIN),
    null,
  );
  return rows === null || rows.length > 0;
}

/**
 * Push entry point for Drive and the Docs home (#1663). The pushed `FileNode`
 * value is the FileNode state (`<seq>.<grantHash>`) `FileNode/changes` takes as `sinceState`, so a
 * value equal to the stored token needs no call. A differing one runs one
 * `FileNode/changes` through the inbound path. Resolves false when the sync
 * failed or the browser is offline, so the hub sends the type again.
 */
export async function syncDriveFileNodesIfStale(
  username: string,
  states: Record<string, string>,
  onSynced?: (result: DriveInboundSyncResult) => void,
): Promise<boolean> {
  const pushed = states.FileNode;
  if (pushed === undefined) return true;
  if (!getConnectivitySnapshot()) return false;
  try {
    // Every subscribed tab gets the push. One at a time: the tab after the
    // first finds the token current and repaints from the notice instead.
    return await withCrossTabLock(`wgw.drive.file-node-push.${username}`, async () => {
      // A sync that started before this change happened may not include it.
      await settleDriveInbound(username);
      if ((await readDriveSyncToken(username)) === pushed) return true;
      const result = await syncDriveInboundFromFileNodes(username);
      if (result.changed || result.listedChanges) notifyDriveRemoteChange(username);
      onSynced?.(result);
      return true;
    });
  } catch (error) {
    console.warn("[drive-inbound] FileNode push sync failed", error);
    return false;
  }
}
