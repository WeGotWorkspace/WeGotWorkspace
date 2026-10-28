const STORAGE_KEY = "wgw:collab-pending-rooms";

let memoryFallback: Set<string> | null = null;
// Counts every set call per room, also those that change nothing, so a reader can tell
// that someone wrote the room while it was reading elsewhere.
const revisions = new Map<string, number>();

function readRooms(): Set<string> {
  if (memoryFallback) return memoryFallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    memoryFallback = new Set<string>();
    return memoryFallback;
  }
}

function writeRooms(rooms: Set<string>): void {
  if (memoryFallback) {
    memoryFallback = rooms;
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...rooms]));
  } catch {
    memoryFallback = rooms;
  }
}

/**
 * Records, in one shared place (local storage, so other tabs see it), which
 * collab rooms hold a deferred server save. The Notes list reads this instead
 * of opening one y-indexeddb database per note on every poll (#1714).
 */
export function setCollabRoomPendingServerSave(room: string, pending: boolean): void {
  if (!room || typeof window === "undefined") return;
  revisions.set(room, (revisions.get(room) ?? 0) + 1);
  const rooms = readRooms();
  if (rooms.has(room) === pending) return;
  if (pending) rooms.add(room);
  else rooms.delete(room);
  writeRooms(rooms);
}

export function isCollabRoomPendingServerSave(room: string): boolean {
  if (!room || typeof window === "undefined") return false;
  return readRooms().has(room);
}

export function getCollabRoomPendingRevision(room: string): number {
  return revisions.get(room) ?? 0;
}
