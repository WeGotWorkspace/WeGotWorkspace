import * as Y from "yjs";
import type { YjsSnapshot } from "./docs-collab-server-io";

/** Backoff for a snapshot that failed for any reason other than "no sidecar". */
export const SNAPSHOT_RETRY_DELAYS_MS = [500, 1500, 4000] as const;

export type SnapshotOutcome =
  | { kind: "snapshot"; update: Uint8Array; etag: string | null }
  /** The server answered 204: there is genuinely no sidecar. Seeding is safe. */
  | { kind: "absent" }
  /** Exhausted the retries. The caller must not seed — it would duplicate. */
  | { kind: "failed"; error: unknown }
  /** The room has no sidecar endpoint (Notes bodies persist over REST). */
  | { kind: "skipped" };

export type BootstrapLoad = {
  markdown: string;
  markdownError: unknown | null;
  snapshot: SnapshotOutcome;
};

export type BootstrapLoadOptions = {
  loadMarkdown: () => Promise<string>;
  /** `null` skips the snapshot entirely. */
  fetchSnapshot: (() => Promise<YjsSnapshot>) | null;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadSnapshotWithRetry(
  fetchSnapshot: () => Promise<YjsSnapshot>,
  sleep: (ms: number) => Promise<void>,
  retryDelaysMs: readonly number[],
): Promise<SnapshotOutcome> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1]!);
    try {
      const snapshot = await fetchSnapshot();
      if (!snapshot.update) return { kind: "absent" };
      return { kind: "snapshot", update: snapshot.update, etag: snapshot.etag };
    } catch (error) {
      lastError = error;
    }
  }

  return { kind: "failed", error: lastError };
}

/**
 * Loads the markdown and the Yjs snapshot together. They used to run one after
 * the other, which added the markdown round trip to every open.
 *
 * A markdown failure is reported, not thrown: the snapshot may still carry the
 * document. A snapshot failure is retried with backoff and never collapses into
 * "no sidecar".
 */
export async function loadBootstrapInParallel({
  loadMarkdown,
  fetchSnapshot,
  sleep = defaultSleep,
  retryDelaysMs = SNAPSHOT_RETRY_DELAYS_MS,
}: BootstrapLoadOptions): Promise<BootstrapLoad> {
  const [markdownResult, snapshot] = await Promise.all([
    loadMarkdown().then(
      (markdown) => ({ markdown, error: null as unknown }),
      (error: unknown) => ({ markdown: "", error }),
    ),
    fetchSnapshot
      ? loadSnapshotWithRetry(fetchSnapshot, sleep, retryDelaysMs)
      : Promise.resolve<SnapshotOutcome>({ kind: "skipped" }),
  ]);

  return {
    markdown: markdownResult.markdown,
    markdownError: markdownResult.error,
    snapshot,
  };
}

export type ServerStateAdoption = "adopt-server" | "merge" | "none";

/**
 * A server snapshot is the shared truth. Merging local IndexedDB state into it
 * is what makes an earlier local seed permanent, so the local state is dropped
 * unless it holds a save that never reached the server.
 */
export function decideServerStateAdoption({
  hasServerSnapshot,
  pendingServerSave,
}: {
  hasServerSnapshot: boolean;
  pendingServerSave: boolean;
}): ServerStateAdoption {
  if (!hasServerSnapshot) return "none";
  return pendingServerSave ? "merge" : "adopt-server";
}

/** Replaces the document content with the server snapshot (Decision 6, "use theirs"). */
export function adoptServerSnapshot(ydoc: Y.Doc, update: Uint8Array, origin: string): void {
  const fragment = ydoc.getXmlFragment("default");
  ydoc.transact(() => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
  }, origin);
  Y.applyUpdate(ydoc, update, origin);
}
