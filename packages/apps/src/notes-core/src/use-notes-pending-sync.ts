import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  hasNoteCollabPendingServerSave,
  noteCollabRoomKey,
} from "@/lib/offline/notes/notes-collab-rooms";
import { listPendingNoteIds, readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import {
  getCollabRoomPendingRevision,
  isCollabRoomPendingServerSave,
  setCollabRoomPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-pending-registry";
import { listExistingIndexedDatabaseNames } from "@/text-editor-core/docs-collab/docs-collab-persistence";

const POLL_INTERVAL_MS = 4000;

/**
 * Ids of notes with unsynced metadata **or** an unsaved UID collab body.
 */
export function useNotesPendingSync(
  username: string | null | undefined,
  refreshKey?: number,
): ReadonlySet<string> {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { online } = useConnectivity();
  // Databases are scanned once per account; later polls read the shared record.
  // The ref holds the scan itself, so a poll during the scan joins it.
  const seedRef = useRef<{ username: string; done: Promise<void> } | null>(null);

  const refresh = useCallback(async () => {
    if (!username) {
      setPendingIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
      return;
    }
    try {
      const ids = new Set(await listPendingNoteIds(username));
      const cached = await readNotesBootstrapFromCache(username);
      const notes = cached?.data.notes ?? [];
      if (seedRef.current?.username !== username) {
        // Seeds the record from databases that predate it (one scan, not per poll).
        const done = seedPendingRecord(notes.map((note) => note.id)).catch((error: unknown) => {
          // Try again on the next poll.
          if (seedRef.current?.done === done) seedRef.current = null;
          throw error;
        });
        seedRef.current = { username, done };
      }
      await seedRef.current.done;
      for (const note of notes) {
        if (ids.has(note.id)) continue;
        if (isCollabRoomPendingServerSave(noteCollabRoomKey(note.id))) ids.add(note.id);
      }
      // Same ids → keep the old set, so the list does not re-render every poll.
      setPendingIds((prev) => (sameIdSet(prev, ids) ? prev : ids));
    } catch {
      // Keep the last known state if the offline store read fails.
    }
  }, [username]);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const intervalId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh, online, refreshKey]);

  return pendingIds;
}

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

async function seedPendingRecord(noteIds: readonly string[]): Promise<void> {
  const existingDatabaseNames = await listExistingIndexedDatabaseNames();
  for (const id of noteIds) {
    const room = noteCollabRoomKey(id);
    const before = getCollabRoomPendingRevision(room);
    const pending = await hasNoteCollabPendingServerSave(id, existingDatabaseNames);
    // An open editor or a finished save wrote the room during the read: keep that.
    if (getCollabRoomPendingRevision(room) === before) {
      setCollabRoomPendingServerSave(room, pending);
    }
  }
}
