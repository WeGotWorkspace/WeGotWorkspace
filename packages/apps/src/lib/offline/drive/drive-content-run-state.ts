/**
 * What the automatic offline copy of Drive file bodies is doing right now, so a
 * row only shows a spinner for a file the current run will still download, and
 * a failed download shows as failed (#2063 measurement 2).
 *
 * - The queue lives in memory: the run belongs to this tab, and a closed tab or
 *   a reload never leaves a stale "downloading" mark behind.
 * - Failures are kept in the meta store, so they survive a reload and the next
 *   run can stop retrying a file that keeps failing.
 */
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

const FAILURES_META_KEY = "drive:auto-sync:content-failures";

/** Automatic attempts for one version of a file; after that only a manual pin retries. */
export const MAX_AUTO_CONTENT_ATTEMPTS = 3;

export type DriveContentFailure = {
  /** Failed automatic attempts for this version of the file. */
  attempts: number;
  /** The listing's modified time (seconds) at the last attempt; a newer version starts over. */
  modifiedAt: number;
};

export type DriveContentFailures = Readonly<Record<string, DriveContentFailure>>;

type RunState = { id: number; queued: Set<string> };

let nextRunId = 0;

const runs = new Map<string, RunState>();
const listeners = new Set<() => void>();

function key(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called after the queue changes or a failure is written. */
export function subscribeDriveContentRunState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Starts a run for `paths`; replaces a previous run's queue for this account.
 * Returns the run's id: finish and end calls from an older run pass it and do
 * nothing once a newer run owns the account's queue.
 */
export function beginDriveContentRun(username: string, paths: readonly string[]): number {
  const id = ++nextRunId;
  runs.set(username, { id, queued: new Set(paths.map(key)) });
  emit();
  return id;
}

/** False once a newer run has replaced `runId` (or it ended). */
export function isCurrentDriveContentRun(username: string, runId: number): boolean {
  return runs.get(username)?.id === runId;
}

/** One file is done (stored, failed or skipped): it no longer spins. */
export function finishDriveContentRunItem(username: string, path: string, runId?: number): void {
  const run = runs.get(username);
  if (runId !== undefined && run?.id !== runId) return;
  if (run?.queued.delete(key(path))) emit();
}

/** The run ended or was aborted: nothing it left behind still downloads. */
export function endDriveContentRun(username: string, runId?: number): void {
  if (runId !== undefined && runs.get(username)?.id !== runId) return;
  if (runs.delete(username)) emit();
}

/** True while this tab's run will still download `path`. */
export function isDriveContentQueued(username: string, path: string): boolean {
  return runs.get(username)?.queued.has(key(path)) ?? false;
}

export async function readDriveContentFailures(username: string): Promise<DriveContentFailures> {
  try {
    const raw = await readMeta(username, FAILURES_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DriveContentFailures) : {};
  } catch {
    return {};
  }
}

async function writeFailures(username: string, failures: DriveContentFailures): Promise<void> {
  try {
    await writeMeta(username, FAILURES_META_KEY, JSON.stringify(failures));
  } catch {
    // The row only loses its failed mark.
  }
  emit();
}

/** Writes are chained per account, so two finishing items do not drop each other's update. */
const writeChains = new Map<string, Promise<void>>();

function updateFailures(
  username: string,
  update: (current: Record<string, DriveContentFailure>) => boolean,
): Promise<void> {
  const previous = writeChains.get(username) ?? Promise.resolve();
  const next = previous.then(async () => {
    const current = { ...(await readDriveContentFailures(username)) };
    if (update(current)) await writeFailures(username, current);
  });
  writeChains.set(
    username,
    next.catch(() => undefined),
  );
  return next;
}

/** A download failed while online: count the attempt for this version of the file. */
export function recordDriveContentFailure(
  username: string,
  path: string,
  modifiedAt: number,
): Promise<void> {
  const id = key(path);
  return updateFailures(username, (current) => {
    const previous = current[id];
    const attempts = previous && previous.modifiedAt === modifiedAt ? previous.attempts + 1 : 1;
    current[id] = { attempts, modifiedAt };
    return true;
  });
}

/** The file is stored now (automatically or by a manual pin): drop its failed mark. */
export function clearDriveContentFailure(username: string, path: string): Promise<void> {
  const id = key(path);
  return updateFailures(username, (current) => {
    if (!(id in current)) return false;
    delete current[id];
    return true;
  });
}

/** Whether the automatic copy should try this version of the file again. */
export function shouldAutoRetryDriveContent(
  failure: DriveContentFailure | undefined,
  modifiedAt: number,
): boolean {
  if (!failure || failure.modifiedAt !== modifiedAt) return true;
  return failure.attempts < MAX_AUTO_CONTENT_ATTEMPTS;
}

/** Test hook: forget every in-memory run. */
export function resetDriveContentRunStateForTests(): void {
  runs.clear();
  writeChains.clear();
}
