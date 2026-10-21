import type { WgwOfflineDatabase } from "@/lib/offline/core/offline-db";

/**
 * `local-*` → server id for creates the server already accepted. Kept in Dexie
 * meta so a writer holding a stale snapshot, or a late optimistic write, can
 * tell the temp row is gone for good instead of putting it back.
 *
 * The mapping cannot go right after the adoption: late writers still carry the
 * temp id (a bootstrap snapshot read earlier, an in-flight or debounced save,
 * another open tab). It is pruned once it is older than {@link ADOPTED_ID_TTL_MS}.
 */
const ADOPTED_NOTE_ID_PREFIX = "notes:adoptedId:";
export const ADOPTED_ID_TTL_MS = 24 * 60 * 60 * 1000;

/** `at`: when the server accepted the create (epoch ms). */
export type AdoptedNoteId = { serverId: string; at: number };

function parseAdoptedNoteId(value: string): AdoptedNoteId {
  try {
    const parsed = JSON.parse(value) as Partial<AdoptedNoteId>;
    if (typeof parsed.serverId === "string" && typeof parsed.at === "number") {
      return { serverId: parsed.serverId, at: parsed.at };
    }
  } catch {
    // A plain server id has no timestamp: treat it as old.
  }
  return { serverId: value, at: 0 };
}

export async function recordAdoptedNoteId(
  db: WgwOfflineDatabase,
  localId: string,
  serverId: string,
): Promise<void> {
  const value: AdoptedNoteId = { serverId, at: Date.now() };
  await db.meta.put({ key: `${ADOPTED_NOTE_ID_PREFIX}${localId}`, value: JSON.stringify(value) });
}

export async function adoptedNoteIdFor(
  db: WgwOfflineDatabase,
  localId: string,
): Promise<string | null> {
  const row = await db.meta.get(`${ADOPTED_NOTE_ID_PREFIX}${localId}`);
  return row?.value ? parseAdoptedNoteId(row.value).serverId : null;
}

/**
 * Every adopted `local-*` id, mapped to its server id and adoption time.
 * Mappings older than {@link ADOPTED_ID_TTL_MS} are still returned once, then
 * deleted.
 */
export async function readAndPruneAdoptedNoteIds(
  db: WgwOfflineDatabase,
): Promise<Map<string, AdoptedNoteId>> {
  const rows = await db.meta.where("key").startsWith(ADOPTED_NOTE_ID_PREFIX).toArray();
  const cutoff = Date.now() - ADOPTED_ID_TTL_MS;
  const adopted = new Map<string, AdoptedNoteId>();
  const expired: string[] = [];
  for (const row of rows) {
    const mapping = parseAdoptedNoteId(row.value);
    adopted.set(row.key.slice(ADOPTED_NOTE_ID_PREFIX.length), mapping);
    if (mapping.at < cutoff) expired.push(row.key);
  }
  if (expired.length > 0) await db.meta.bulkDelete(expired);
  return adopted;
}

/**
 * A `local-*` create whose POST is out. The healer must not create it again
 * meanwhile: another tab sees the same pending row without an outbox row or
 * mapping. A tab can close mid-POST, so the marker expires. After that the
 * client cannot tell whether the server created the note, and the healer
 * creates it again; an idempotent server create is the planned fix.
 */
const CREATE_IN_FLIGHT_PREFIX = "notes:createInFlight:";
export const CREATE_IN_FLIGHT_TTL_MS = 5 * 60 * 1000;

export async function markCreateInFlight(db: WgwOfflineDatabase, localId: string): Promise<void> {
  await db.meta.put({ key: `${CREATE_IN_FLIGHT_PREFIX}${localId}`, value: String(Date.now()) });
}

export async function clearCreateInFlight(db: WgwOfflineDatabase, localId: string): Promise<void> {
  await db.meta.delete(`${CREATE_IN_FLIGHT_PREFIX}${localId}`);
}

/** True while a fresh marker exists. A stale marker is removed. */
export async function isCreateInFlight(db: WgwOfflineDatabase, localId: string): Promise<boolean> {
  const row = await db.meta.get(`${CREATE_IN_FLIGHT_PREFIX}${localId}`);
  if (!row) return false;
  if (Date.now() - Number(row.value) < CREATE_IN_FLIGHT_TTL_MS) return true;
  await clearCreateInFlight(db, localId);
  return false;
}
