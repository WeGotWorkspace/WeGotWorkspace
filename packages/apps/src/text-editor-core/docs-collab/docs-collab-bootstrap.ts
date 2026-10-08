import * as encoding from "lib0/encoding";
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
  /**
   * Abandons the retries once the join that started them is gone, so a torn
   * down session stops hitting the server.
   */
  isCurrent?: () => boolean;
  /**
   * Reports every failed attempt as it happens. The room-level backoff must
   * engage on the first failure, not only once the retries are exhausted.
   */
  onAttemptFailed?: (error: unknown) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type SnapshotRetryContext = {
  sleep: (ms: number) => Promise<void>;
  retryDelaysMs: readonly number[];
  isCurrent: () => boolean;
  onAttemptFailed: (error: unknown) => void;
};

async function loadSnapshotWithRetry(
  fetchSnapshot: () => Promise<YjsSnapshot>,
  { sleep, retryDelaysMs, isCurrent, onAttemptFailed }: SnapshotRetryContext,
): Promise<SnapshotOutcome> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(retryDelaysMs[attempt - 1]!);
      if (!isCurrent()) break;
    }
    try {
      const snapshot = await fetchSnapshot();
      if (!snapshot.update) return { kind: "absent" };
      return { kind: "snapshot", update: snapshot.update, etag: snapshot.etag };
    } catch (error) {
      lastError = error;
      onAttemptFailed(error);
      if (!isCurrent()) break;
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
  isCurrent = () => true,
  onAttemptFailed = () => undefined,
}: BootstrapLoadOptions): Promise<BootstrapLoad> {
  const [markdownResult, snapshot] = await Promise.all([
    loadMarkdown().then(
      (markdown) => ({ markdown, error: null as unknown }),
      (error: unknown) => {
        onAttemptFailed(error);
        return { markdown: "", error };
      },
    ),
    fetchSnapshot
      ? loadSnapshotWithRetry(fetchSnapshot, {
          sleep,
          retryDelaysMs,
          isCurrent,
          onAttemptFailed,
        })
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

/**
 * Adopt the server snapshot: apply it, then delete only the items this doc
 * has that the server does not (a stale local seed). Never wipe the body —
 * items the doc already holds are skipped by applyUpdate, so a wipe would stick.
 */
export function adoptServerSnapshot(ydoc: Y.Doc, update: Uint8Array, origin: string): void {
  const serverSv = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
  const localSv = Y.decodeStateVector(Y.encodeStateVector(ydoc));
  const localOnly: Array<[client: number, clock: number, len: number]> = [];
  for (const [client, localClock] of localSv) {
    const serverClock = serverSv.get(client) ?? 0;
    if (localClock > serverClock) localOnly.push([client, serverClock, localClock - serverClock]);
  }
  ydoc.transact(() => {
    Y.applyUpdate(ydoc, update, origin);
    if (localOnly.length === 0) return;
    const encoder = new Y.UpdateEncoderV1();
    encoding.writeVarUint(encoder.restEncoder, 0); // no structs, delete set only
    encoding.writeVarUint(encoder.restEncoder, localOnly.length);
    for (const [client, clock, len] of localOnly) {
      encoder.resetDsCurVal();
      encoding.writeVarUint(encoder.restEncoder, client);
      encoding.writeVarUint(encoder.restEncoder, 1);
      encoder.writeDsClock(clock);
      encoder.writeDsLen(len);
    }
    Y.applyUpdate(ydoc, encoder.toUint8Array(), origin);
  }, origin);
}
