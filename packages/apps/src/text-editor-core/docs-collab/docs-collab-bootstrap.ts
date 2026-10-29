import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import type { YjsSnapshot } from "./docs-collab-server-io";
import { type ClockRange, findStaleSeedRanges } from "./docs-collab-stale-seed";
import { isCollabDocumentGoneError } from "./docs-collab-utils";

/** Backoff for a snapshot that failed for any reason other than "no sidecar". */
export const SNAPSHOT_RETRY_DELAYS_MS = [500, 1500, 4000] as const;

export type SnapshotOutcome =
  | { kind: "snapshot"; update: Uint8Array; etag: string | null; externalWrite: boolean }
  /** The server answered 204: there is genuinely no sidecar. Seeding is safe. */
  | {
      kind: "absent";
      /** The markdown, when the request asked the server for it as fallback. */
      markdown?: string;
    }
  /** Exhausted the retries. The caller must not seed — it would duplicate. */
  | { kind: "failed"; error: unknown }
  /** The caller did not supply a snapshot endpoint. */
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
      if (!snapshot.update) {
        return snapshot.markdown === undefined
          ? { kind: "absent" }
          : { kind: "absent", markdown: snapshot.markdown };
      }
      return {
        kind: "snapshot",
        update: snapshot.update,
        etag: snapshot.etag,
        externalWrite: snapshot.externalWrite === true,
      };
    } catch (error) {
      lastError = error;
      onAttemptFailed(error);
      if (!isCurrent()) break;
      if (isCollabDocumentGoneError(error)) break;
    }
  }

  return { kind: "failed", error: lastError };
}

/** The snapshot alone, with the same retries and C7 outcome as the bootstrap. */
export function loadSnapshotOutcome(
  fetchSnapshot: () => Promise<YjsSnapshot>,
  {
    sleep = defaultSleep,
    retryDelaysMs = SNAPSHOT_RETRY_DELAYS_MS,
    isCurrent = () => true,
    onAttemptFailed = () => undefined,
  }: Omit<BootstrapLoadOptions, "loadMarkdown" | "fetchSnapshot"> = {},
): Promise<SnapshotOutcome> {
  return loadSnapshotWithRetry(fetchSnapshot, { sleep, retryDelaysMs, isCurrent, onAttemptFailed });
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

export type AdoptServerSnapshotOptions = {
  /**
   * Keep the loaded items that were written on top of server content and drop
   * only a seed the local copy built on its own (`findStaleSeedRanges`). The
   * shared local copy also holds text other tabs typed but have not saved yet
   * (#1722). The join bootstrap sets this; an outside rewrite does not.
   */
  keepUnsavedEdits?: boolean;
};

/**
 * Adopt the server snapshot: apply it, then delete the local items it lacks
 * that are a stale local seed. Never wipe the body — items the doc already
 * holds are skipped by applyUpdate, so a wipe would stick.
 *
 * `loadedStateVector` is the doc's state when its local copy finished loading.
 * Only those items can be a stale seed; anything added since was typed or
 * received in this session and is kept. Without it every item the server
 * lacks is dropped (an outside rewrite replaces the whole document).
 *
 * Returns whether any local item was dropped.
 */
export function adoptServerSnapshot(
  ydoc: Y.Doc,
  update: Uint8Array,
  origin: string,
  loadedStateVector?: ReadonlyMap<number, number>,
  { keepUnsavedEdits = false }: AdoptServerSnapshotOptions = {},
): boolean {
  const serverSv = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
  const localSv = Y.decodeStateVector(Y.encodeStateVector(ydoc));
  const localOnly = localItemsTheServerLacks(localSv, serverSv, loadedStateVector ?? localSv);
  if (localOnly.length === 0) {
    Y.applyUpdate(ydoc, update, origin);
    return false;
  }
  let dropped = false;
  ydoc.transact(() => {
    Y.applyUpdate(ydoc, update, origin);
    // The stale-seed check reads the server's content, so it runs after the apply.
    const stale = keepUnsavedEdits ? findStaleSeedRanges(ydoc, localOnly) : localOnly;
    if (stale.length === 0) return;
    Y.applyUpdate(ydoc, encodeDeleteSet(stale), origin);
    dropped = true;
  }, origin);
  return dropped;
}

/** Per client, the clocks the local doc holds, up to `limit`, past the server's. */
function localItemsTheServerLacks(
  localSv: ReadonlyMap<number, number>,
  serverSv: ReadonlyMap<number, number>,
  limit: ReadonlyMap<number, number>,
): ClockRange[] {
  const ranges: ClockRange[] = [];
  for (const [client, localClock] of localSv) {
    const serverClock = serverSv.get(client) ?? 0;
    const end = Math.min(localClock, limit.get(client) ?? 0);
    if (end > serverClock) ranges.push({ client, clock: serverClock, len: end - serverClock });
  }
  return ranges;
}

/** An update with no structs, only a delete set. Ranges are sorted by client. */
function encodeDeleteSet(ranges: readonly ClockRange[]): Uint8Array {
  const byClient = new Map<number, ClockRange[]>();
  for (const range of ranges) {
    const list = byClient.get(range.client) ?? [];
    list.push(range);
    byClient.set(range.client, list);
  }
  const encoder = new Y.UpdateEncoderV1();
  encoding.writeVarUint(encoder.restEncoder, 0); // no structs
  encoding.writeVarUint(encoder.restEncoder, byClient.size);
  for (const [client, list] of byClient) {
    encoder.resetDsCurVal();
    encoding.writeVarUint(encoder.restEncoder, client);
    encoding.writeVarUint(encoder.restEncoder, list.length);
    for (const { clock, len } of list) {
      encoder.writeDsClock(clock);
      encoder.writeDsLen(len);
    }
  }
  return encoder.toUint8Array();
}
