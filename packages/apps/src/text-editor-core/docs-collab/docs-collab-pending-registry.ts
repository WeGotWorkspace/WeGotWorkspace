const STORAGE_KEY = "wgw:collab-pending-rooms";

interface PendingState {
  rooms: Set<string>;
  // Counts every set call per room, also those that change nothing, so a reader can tell
  // that someone, in any tab, wrote the room while it was reading elsewhere.
  revisions: Record<string, number>;
}

let memoryFallback: PendingState | null = null;

function readState(): PendingState {
  if (memoryFallback) return memoryFallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // A plain array is the older format: every room has counter 0.
    const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { rooms?: unknown })?.rooms;
    const rooms = new Set(Array.isArray(list) ? list.filter((v) => typeof v === "string") : []);
    const revisions: Record<string, number> = {};
    const stored = Array.isArray(parsed) ? null : (parsed as { revisions?: unknown })?.revisions;
    if (stored && typeof stored === "object") {
      for (const [room, n] of Object.entries(stored)) {
        if (typeof n === "number") revisions[room] = n;
      }
    }
    return { rooms, revisions };
  } catch {
    memoryFallback = { rooms: new Set<string>(), revisions: {} };
    return memoryFallback;
  }
}

function writeState(state: PendingState): void {
  if (memoryFallback) {
    memoryFallback = state;
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rooms: [...state.rooms], revisions: state.revisions }),
    );
  } catch {
    memoryFallback = state;
  }
}

/**
 * Records, in one shared place (local storage, so other tabs see it), which
 * collab rooms hold a deferred server save. The Notes list reads this instead
 * of opening one y-indexeddb database per note on every poll (#1714).
 */
export function setCollabRoomPendingServerSave(room: string, pending: boolean): void {
  if (!room || typeof window === "undefined") return;
  const state = readState();
  state.revisions[room] = (state.revisions[room] ?? 0) + 1;
  if (pending) state.rooms.add(room);
  else state.rooms.delete(room);
  writeState(state);
}

export function isCollabRoomPendingServerSave(room: string): boolean {
  if (!room || typeof window === "undefined") return false;
  return readState().rooms.has(room);
}

export function getCollabRoomPendingRevision(room: string): number {
  if (!room || typeof window === "undefined") return 0;
  return readState().revisions[room] ?? 0;
}
