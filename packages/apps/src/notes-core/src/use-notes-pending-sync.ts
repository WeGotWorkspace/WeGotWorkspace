import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { hasNoteCollabPendingServerSave } from "@/lib/offline/notes/notes-collab-rooms";
import { listPendingNoteIds, readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";

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
      setPendingIds(new Set<string>());
      return;
    }
    try {
      const ids = new Set(await listPendingNoteIds(username));
      const cached = await readNotesBootstrapFromCache(username);
      for (const note of cached?.data.notes ?? []) {
        if (ids.has(note.id)) continue;
        if (await hasNoteCollabPendingServerSave(note.id)) ids.add(note.id);
      }
      setPendingIds(ids);
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
