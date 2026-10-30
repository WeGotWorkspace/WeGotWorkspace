import type { OfflineOutboxRow } from "./types";

/**
 * The inbound half of offline sync, shared by the offline collections (#1565).
 * Domains bind their store and API to it, so a fix here reaches every domain.
 * Polling and triggers stay with the callers.
 */

// ---------------------------------------------------------------------------
// Pending writes
// ---------------------------------------------------------------------------

/** What inbound must know about the local writes still queued for one item. */
export type PendingWrite<F extends string = string> = {
  /** Server versions the queued rows started from (`ifInState`), oldest first. */
  bases: string[];
  /** Fields the queued rows change. */
  fields: Set<F>;
  /** A local delete is queued: the user wants the item gone too. */
  deleting: boolean;
  /**
   * A queued row will still be sent, so a skipped server change must come back
   * next run. A `stateMismatch` row waits for a person and does not hold a token.
   */
  blocksToken: boolean;
  /** At least one outbox row targets the item (not only a `pendingSync` cache row). */
  queued: boolean;
};

/** How a domain reads one of its outbox rows. */
export type PendingRowView<F extends string = string> = {
  id: string | null;
  fields?: Iterable<F>;
  deleting?: boolean;
};

function emptyWrite<F extends string>(): PendingWrite<F> {
  return { bases: [], fields: new Set(), deleting: false, blocksToken: false, queued: false };
}

/**
 * Pending writes by item id, from a domain's outbox rows plus its `pendingSync`
 * cache rows. A queued delete has no cache row any more, so the outbox is what
 * keeps it from coming back.
 */
export function readPendingWrites<F extends string = string>(
  rows: readonly OfflineOutboxRow[],
  view: (row: OfflineOutboxRow) => PendingRowView<F>,
  pendingSyncIds: Iterable<string> = [],
): Map<string, PendingWrite<F>> {
  const writes = new Map<string, PendingWrite<F>>();
  for (const row of rows) {
    const { id, fields, deleting } = view(row);
    if (!id) continue;
    const write = writes.get(id) ?? emptyWrite<F>();
    write.queued = true;
    if (row.ifInState) write.bases.push(row.ifInState);
    for (const field of fields ?? []) write.fields.add(field);
    if (deleting) write.deleting = true;
    if (row.lastError !== "stateMismatch") write.blocksToken = true;
    writes.set(id, write);
  }
  for (const id of pendingSyncIds) {
    if (!writes.has(id)) writes.set(id, emptyWrite<F>());
  }
  return writes;
}

// ---------------------------------------------------------------------------
// Conflict decision
// ---------------------------------------------------------------------------

/**
 * What a queued write with no recorded base, or a server row with no version,
 * counts as. Notes counts it as moved (it reported such clashes before bases
 * were recorded); Tasks as not moved.
 */
export type UnknownBasePolicy = "moved" | "not-moved";

/**
 * True when the server's version differs from a version a queued write started
 * from. With the same version, the server simply has not seen the queued change
 * yet, which is not a conflict.
 */
export function serverMovedSince(
  bases: readonly string[],
  remoteVersion: string | null | undefined,
  unknownBase: UnknownBasePolicy,
): boolean {
  if (bases.length === 0 || !remoteVersion) return unknownBase === "moved";
  return bases.some((base) => base !== remoteVersion);
}

// ---------------------------------------------------------------------------
// Scope reconcile
// ---------------------------------------------------------------------------

/**
 * After a full list of a scope: the cached ids the list lacks, minus those the
 * domain keeps (queued, `createPending`). A queued item is "not sent yet", not
 * "deleted elsewhere".
 */
export function listRemovedIds<T extends { id: string }>(
  cached: Iterable<T>,
  listedIds: ReadonlySet<string>,
  keep: (item: T) => boolean,
): string[] {
  const removed: string[] = [];
  for (const item of cached) {
    if (listedIds.has(item.id) || keep(item)) continue;
    removed.push(item.id);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Changes per scope, with a full-list fallback
// ---------------------------------------------------------------------------

/** One scope's `/changes` answer. */
export type ScopeChanges = {
  created: readonly string[];
  updated: readonly string[];
  destroyed: readonly string[];
  newState: string;
};

export type IngestOutcome = "upserted" | "merged-pending" | "skipped-pending";
export type DestroyOutcome = "removed" | "skipped-pending";

/** Applies server rows to the cache. Created right before the first write. */
export type ScopedInboundApplier<Row> = {
  ingest(row: Row): Promise<IngestOutcome>;
  ingestDestroyed(id: string): Promise<DestroyOutcome>;
  /** Ids whose skipped change holds their scope's token (see `PendingWrite.blocksToken`). */
  blocksToken: ReadonlySet<string>;
};

export type ScopedInboundBinding<Row, Cached extends { id: string; scope?: string | undefined }> = {
  readToken(scope: string): Promise<string | null>;
  writeToken(scope: string, token: string): Promise<void>;
  changes(scope: string, since: string): Promise<ScopeChanges>;
  isCannotCalculateChanges(error: unknown): boolean;
  /** Every row of a scope. */
  list(scope: string): Promise<Row[]>;
  /** The state to resume from after a full list. */
  currentState(scope: string): Promise<string>;
  rowId(row: Row): string;
  /** One changed row, for ids a full list did not already return. */
  fetch(id: string): Promise<Row>;
  /** The cache and the queued ids, read once before the run, for full-list removals. */
  readCached(): Promise<{ items: readonly Cached[]; keep: (item: Cached) => boolean }>;
  /** A scope the server no longer has. Handled scopes count as changed. */
  scopeGone?: { matches(error: unknown): boolean; apply(scope: string): Promise<void> };
  createApplier(): Promise<ScopedInboundApplier<Row>>;
};

export type ScopedInboundResult = { changed: boolean; usedFullResync: boolean };

type ScopeDelta = ScopeChanges & { scope: string };

/**
 * Pull every scope's changes since its stored token and apply them. A scope
 * with no token, or whose token the server can no longer resolve, is listed in
 * full instead; cached items it lacks are removed unless the domain keeps them.
 *
 * Changes are merged across scopes before they are applied, so an item that
 * moved between two scopes in one run is upserted, not destroyed. A scope's
 * token advances only when none of its ids was skipped for a queued write that
 * will still be sent, so the skipped change comes back next run.
 */
export async function runScopedInbound<
  Row,
  Cached extends { id: string; scope?: string | undefined },
>(
  scopes: readonly string[],
  binding: ScopedInboundBinding<Row, Cached>,
): Promise<ScopedInboundResult> {
  let changed = false;
  let usedFullResync = false;
  const deltas: ScopeDelta[] = [];
  const listedRows = new Map<string, Row>();
  const removed: string[] = [];
  const cached = await binding.readCached();

  const fullList = async (scope: string) => {
    usedFullResync = true;
    const rows = await binding.list(scope);
    for (const row of rows) listedRows.set(binding.rowId(row), row);
    const listed = new Set(rows.map((row) => binding.rowId(row)));
    const inScope = cached.items.filter((item) => item.scope === scope);
    removed.push(...listRemovedIds(inScope, listed, cached.keep));
    deltas.push({
      scope,
      created: [...listed],
      updated: [],
      destroyed: [],
      newState: await binding.currentState(scope),
    });
  };

  for (const scope of scopes) {
    const since = await binding.readToken(scope);
    // No token yet: "changes since 0" names every item and costs a fetch each.
    if (since === null) {
      await fullList(scope);
      continue;
    }
    try {
      deltas.push({ scope, ...(await binding.changes(scope, since)) });
    } catch (error) {
      if (binding.scopeGone?.matches(error)) {
        await binding.scopeGone.apply(scope);
        changed = true;
        continue;
      }
      if (!binding.isCannotCalculateChanges(error)) throw error;
      await fullList(scope);
    }
  }

  // Created ids first, then updated ones, each once.
  const upserted = new Set<string>();
  for (const delta of deltas) for (const id of delta.created) upserted.add(id);
  for (const delta of deltas) for (const id of delta.updated) upserted.add(id);
  const destroyed = new Set<string>();
  for (const delta of deltas) for (const id of delta.destroyed) destroyed.add(id);
  for (const id of removed) destroyed.add(id);
  const destroyIds = [...destroyed].filter((id) => !upserted.has(id));

  const applier = await binding.createApplier();
  const skipped = new Set<string>();
  for (const id of upserted) {
    const row = listedRows.get(id) ?? (await binding.fetch(id));
    const result = await applier.ingest(row);
    if (result === "upserted" || result === "merged-pending") changed = true;
    if (result === "skipped-pending" && applier.blocksToken.has(id)) skipped.add(id);
  }
  for (const id of destroyIds) {
    const result = await applier.ingestDestroyed(id);
    if (result === "skipped-pending" && applier.blocksToken.has(id)) skipped.add(id);
    if (result === "removed") changed = true;
  }
  for (const delta of deltas) {
    const held = [...delta.created, ...delta.updated, ...delta.destroyed].some((id) =>
      skipped.has(id),
    );
    if (!held) await binding.writeToken(delta.scope, delta.newState);
  }
  return { changed, usedFullResync };
}
