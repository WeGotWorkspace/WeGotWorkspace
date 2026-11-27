import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { readOfflineDocsUsername } from "@/lib/offline/core/offline-session";
import { notifyDocsCachesChanged } from "@/lib/offline/docs/docs-inbound-sync";
import {
  flushDocsOutbox,
  type DocsOutboxPayload,
  type OutboxFlushResult,
} from "@/lib/offline/docs/docs-outbox-flush";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";

/**
 * The Docs outbox (#1563). Since #2063 C4 Docs home writes (rename, move,
 * trash, star) go through Drive's operations into the Drive outbox; this one
 * holds the editor's offline creates, and rows queued before that change.
 */

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>(DOCS_DOMAIN);

async function flushDocsOutboxTask(username: string): Promise<OutboxFlushResult> {
  const result = await flushDocsOutbox(username);
  reportDocsSyncConflicts(result.stateMismatches);
  if (result.flushed > 0) {
    // Open tabs re-read what the flush settled (an editor waiting on a queued create).
    notifyDocsCachesChanged(username);
    // Every view of the tree reads again: the queued writes are on the server now.
    notifyDriveRemoteChange(username);
  }
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushDocsOutboxTask(username));
}

export function getDocsSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}

export async function flushDocsOutboxForAccount(
  username?: string | null,
): Promise<OutboxFlushResult | null> {
  const resolved = username ?? readOfflineDocsUsername();
  if (!resolved) return null;
  const result = await runnerFor(resolved).flush();
  return result ?? null;
}

/** Queue a Docs write; send it at once when the connection is already back (#2104). */
export async function queueDocsOutbox(username: string, payload: DocsOutboxPayload): Promise<void> {
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: DOCS_DOMAIN,
    op: payload.op,
    payload: JSON.stringify(payload),
  });
  if (readBrowserOnline()) void runnerFor(username).flushAfterWrite();
}
