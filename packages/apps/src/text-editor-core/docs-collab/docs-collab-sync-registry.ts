export type DocsCollabSyncState = {
  pendingServerSave: boolean;
  failedSync: boolean;
};

const EMPTY_STATE: DocsCollabSyncState = {
  pendingServerSave: false,
  failedSync: false,
};

const states = new Map<string, DocsCollabSyncState>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getDocsCollabSyncState(room: string | undefined): DocsCollabSyncState {
  if (!room) return EMPTY_STATE;
  return states.get(room) ?? EMPTY_STATE;
}

export function setDocsCollabSyncState(
  room: string | undefined,
  patch: Partial<DocsCollabSyncState>,
): void {
  if (!room) return;
  const prev = states.get(room) ?? EMPTY_STATE;
  states.set(room, { ...prev, ...patch });
  notify();
}

export function clearDocsCollabSyncState(room: string | undefined): void {
  if (!room) return;
  states.delete(room);
  notify();
}

export function subscribeDocsCollabSyncState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const openRooms = new Map<string, number>();

/** An editor in this tab has the room open and saves it itself. Returns the release. */
export function holdOpenCollabRoom(room: string): () => void {
  openRooms.set(room, (openRooms.get(room) ?? 0) + 1);
  return () => {
    const left = (openRooms.get(room) ?? 1) - 1;
    if (left > 0) openRooms.set(room, left);
    else openRooms.delete(room);
  };
}

export function isCollabRoomOpen(room: string): boolean {
  return openRooms.has(room);
}
