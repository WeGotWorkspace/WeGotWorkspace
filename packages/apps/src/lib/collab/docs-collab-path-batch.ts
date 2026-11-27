import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { setCollabRoomPendingServerSave } from "./docs-collab-pending-registry";
import {
  docsCollabRoomKey,
  indexedDbNamesForRoom,
  listExistingIndexedDatabaseNames,
} from "./docs-collab-persistence";
import { isYDocEmpty } from "./docs-collab-utils";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

/** One relocated Doc of a sync batch: its path before the batch and its final path. */
export type DocsCollabPathMove = { from: string; to: string };

type Captured = { update: Uint8Array | null; pendingServerSave: boolean };

async function openPersistence<T>(
  name: string,
  work: (persistence: IndexeddbPersistence, doc: Y.Doc) => Promise<T>,
): Promise<T> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, doc);
  try {
    await persistence.whenSynced;
    return await work(persistence, doc);
  } finally {
    await persistence.destroy();
    doc.destroy();
  }
}

/** The body and pending flag of one database, or null when it holds neither. */
function capture(name: string): Promise<Captured | null> {
  return openPersistence(name, async (persistence, doc) => {
    const pendingServerSave = Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY));
    const update = isYDocEmpty(doc) ? null : Y.encodeStateAsUpdate(doc);
    return update || pendingServerSave ? { update, pendingServerSave } : null;
  });
}

function clear(name: string): Promise<void> {
  return openPersistence(name, (persistence) => persistence.clearData());
}

/** `name` holds `state` alone: whatever it held before is cleared first. */
async function writeAlone(name: string, state: Captured): Promise<void> {
  await clear(name);
  await openPersistence(name, async (persistence, doc) => {
    if (state.update) Y.applyUpdate(doc, state.update);
    // A path-keyed body never reached the server under its new path: it stays
    // unsaved, so the server-id session uploads it (same rule as a single move).
    await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  });
}

function roomOf(path: string): string | null {
  return docsCollabRoomKey(path) || null;
}

/**
 * The path-keyed collab databases (`:v2` and pre-v2 names) of a sync batch
 * follow its final map (#2063 C7). Every source is read once, from its path
 * before the batch, before anything is written; each destination then holds
 * its own source's state alone (never merged with what was there); a source
 * that is no destination is cleared only after the writes. Exact paths only:
 * the batch lists every relocated file, so a folder is never prefix-expanded.
 * So two Docs that swap paths keep their own local text.
 */
export async function moveDocsCollabPathDatabasesInBatch(
  moves: readonly DocsCollabPathMove[],
): Promise<void> {
  const existing = await listExistingIndexedDatabaseNames();
  const exists = (name: string) => !existing || existing.has(name);
  const plan: Array<{ toName: string; toRoom: string; state: Captured | null }> = [];
  const sources = new Map<string, string>();
  for (const move of moves) {
    const fromRoom = roomOf(move.from);
    const toRoom = roomOf(move.to);
    if (!fromRoom || !toRoom || fromRoom === toRoom) continue;
    const fromNames = indexedDbNamesForRoom(fromRoom);
    const toNames = indexedDbNamesForRoom(toRoom);
    for (const name of fromNames) sources.set(name, fromRoom);
    for (const [index, fromName] of fromNames.entries()) {
      const toName = toNames[index];
      if (!toName) continue;
      plan.push({ toName, toRoom, state: exists(fromName) ? await capture(fromName) : null });
    }
  }
  const written = new Set<string>();
  for (const { toName, toRoom, state } of plan) {
    written.add(toName);
    if (state) {
      await writeAlone(toName, state);
      setCollabRoomPendingServerSave(toRoom, true);
    } else if (exists(toName) && sources.has(toName)) {
      // Its own Doc moved away and nothing moved in: no stale text stays.
      await clear(toName);
      setCollabRoomPendingServerSave(toRoom, false);
    }
  }
  for (const [name, room] of sources) {
    if (written.has(name) || !exists(name)) continue;
    await clear(name);
    setCollabRoomPendingServerSave(room, false);
  }
}
