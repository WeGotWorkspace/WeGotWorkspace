import type { WgwOfflineDatabase } from "@/lib/offline/core/offline-db";

/**
 * `local-*` → server id for creates the server already accepted. Kept in Dexie
 * meta so a writer holding a stale snapshot, or a late optimistic write, can
 * tell the temp row is gone for good instead of putting it back.
 */
const ADOPTED_NOTE_ID_PREFIX = "notes:adoptedId:";

export async function recordAdoptedNoteId(
  db: WgwOfflineDatabase,
  localId: string,
  serverId: string,
): Promise<void> {
  await db.meta.put({ key: `${ADOPTED_NOTE_ID_PREFIX}${localId}`, value: serverId });
}

export async function adoptedNoteIdFor(
  db: WgwOfflineDatabase,
  localId: string,
): Promise<string | null> {
  const row = await db.meta.get(`${ADOPTED_NOTE_ID_PREFIX}${localId}`);
  return row?.value ?? null;
}

/** Every adopted `local-*` id, mapped to its server id. */
export async function readAdoptedNoteIds(db: WgwOfflineDatabase): Promise<Map<string, string>> {
  const rows = await db.meta.where("key").startsWith(ADOPTED_NOTE_ID_PREFIX).toArray();
  return new Map(
    rows.map((row) => [row.key.slice(ADOPTED_NOTE_ID_PREFIX.length), row.value] as const),
  );
}
