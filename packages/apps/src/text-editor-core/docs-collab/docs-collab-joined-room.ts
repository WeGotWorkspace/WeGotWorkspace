import type { MutableRefObject } from "react";
import type { IndexeddbPersistence } from "y-indexeddb";
import { closeCollabRoomStore, type CollabRoomLeftUnsaved } from "./docs-collab-leave-room";
import { cancelSaveTimer } from "./docs-collab-save-timer";

/** The room and urls each open store was joined with. */
const joinedRooms = new WeakMap<IndexeddbPersistence, CollabRoomLeftUnsaved>();

/** Records the room a store was opened for, at join. */
export function rememberCollabRoomJoin(
  persistence: IndexeddbPersistence,
  joined: CollabRoomLeftUnsaved,
): void {
  joinedRooms.set(persistence, joined);
}

/**
 * Leaves a room at teardown: cancels its armed save and closes its store. When
 * a save was still due, the store is saved in the background
 * (`closeCollabRoomStore`). Teardown can run in a render that already carries
 * the next room (Docs keeps the editor mounted across a room change), so that
 * save goes to the room the store was joined with, not to `current`. A room
 * held off the server (`roomNotPersistent`) is not saved, but its store is
 * still marked unsaved, as its save timer would have done: otherwise text
 * typed within the save delay before a followed rename is dropped (#1563).
 */
export function leaveCollabRoom(
  persistence: IndexeddbPersistence | null,
  saveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  current: CollabRoomLeftUnsaved,
): void {
  const saveDue = cancelSaveTimer(saveTimerRef);
  if (!persistence) return;
  const joined = joinedRooms.get(persistence) ?? current;
  joinedRooms.delete(persistence);
  void closeCollabRoomStore(persistence, saveDue ? joined : null, {
    upload: !joined.urls.roomNotPersistent,
  });
}
