import type { Table } from "dexie";
import type { WgwOfflineDatabase } from "@/lib/offline/core/offline-db";

/**
 * The pieces every domain's bootstrap mirror shares (#1565): a session row in
 * `meta`, and per table JSON `data` rows that a bootstrap replaces while the
 * rows with an unsynced local change stay. Each domain keeps its own
 * `read*BootstrapFromCache` / `write*BootstrapToCache` (they differ in extra
 * meta rows, transactions and which rows survive) and builds them from these.
 *
 * All of them run inside the caller's Dexie transaction when there is one.
 */

/** A row whose `data` holds one entity as JSON. */
export type MirrorDataRow = { data: string };

/**
 * The cached session under `key`, or null when none was stored: until a live
 * bootstrap was cached, there is nothing to read back.
 */
export async function readMirrorSession<TSession>(
  db: WgwOfflineDatabase,
  key: string,
): Promise<TSession | null> {
  const row = await db.meta.get(key);
  if (!row?.value) return null;
  return JSON.parse(row.value) as TSession;
}

/** Stores the bootstrap's session under `key`. */
export async function writeMirrorSession(
  db: WgwOfflineDatabase,
  key: string,
  session: unknown,
): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(session) });
}

/** The entities in `rows`, in row order. */
export function parseMirrorRows<TEntity>(rows: readonly MirrorDataRow[]): TEntity[] {
  return rows.map((row) => JSON.parse(row.data) as TEntity);
}

/** A row with an unsynced local change: a bootstrap must not overwrite it. */
export function isPendingMirrorRow(row: { pendingSync?: boolean }): boolean {
  return row.pendingSync === true;
}

export type ReplaceMirrorRowsOptions<TRow, TInsert> = {
  /** The cached rows that survive the replace. Default: rows with a pending local change. */
  keep?: (row: TRow) => boolean;
  /** What a kept row is written back as. Default: the row unchanged. */
  restore?: (row: TRow) => TInsert;
};

/**
 * Replaces `table`'s rows with `rows`. The cached rows `keep` names are read
 * first and written back over them, so a snapshot never overwrites a local
 * change it has not seen.
 */
export async function replaceMirrorRows<TRow extends TInsert, TKey, TInsert>(
  table: Table<TRow, TKey, TInsert>,
  rows: readonly TInsert[],
  options: ReplaceMirrorRowsOptions<TRow, TInsert> = {},
): Promise<void> {
  const keep =
    options.keep ?? ((row: TRow) => isPendingMirrorRow(row as { pendingSync?: boolean }));
  const kept = await table.filter(keep).toArray();
  await table.clear();
  await table.bulkPut([...rows]);
  if (kept.length > 0) {
    await table.bulkPut(options.restore ? kept.map(options.restore) : kept);
  }
}
