import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { hasNoteCollabPendingServerSave } from "@/lib/offline/notes/notes-collab-rooms";
import { listPendingNoteIds, readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
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

  const refresh = useCallback(async () => {
    if (!username) {
      setPendingIds((prev) => (prev.size === 0 ? prev : new Set<string>()));
      return;
    }
    try {
      const ids = new Set(await listPendingNoteIds(username));
      const cached = await readNotesBootstrapFromCache(username);
      const existingDatabaseNames = await listExistingIndexedDatabaseNames();
      for (const note of cached?.data.notes ?? []) {
        if (ids.has(note.id)) continue;
        if (await hasNoteCollabPendingServerSave(note.id, existingDatabaseNames)) ids.add(note.id);
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
