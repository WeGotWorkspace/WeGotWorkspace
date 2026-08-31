import type { Note } from "@/lib/models/note";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  isEligibleForAutoContentSync,
  readOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import {
  emptyProgressiveSyncProgress,
  readProgressiveSyncProgress,
  type ProgressiveSyncProgress,
} from "@/lib/offline/core/progressive-sync-runner";

const NOTES_BODY_SYNC_META_KEY = "notes:auto-sync:body-progress";

export type NotesBodySyncProgress = ProgressiveSyncProgress;

function emptyProgress(): NotesBodySyncProgress {
  return emptyProgressiveSyncProgress();
}

export async function readNotesBodySyncProgress(username: string): Promise<NotesBodySyncProgress> {
  return readProgressiveSyncProgress(username, NOTES_BODY_SYNC_META_KEY);
}

/**
 * Bodies already live on the Dexie note row (inbound GET / Note/get).
 * Do not hydrate via Drive `/files/collaboration`.
 */
export async function syncNotesBodiesForOffline(
  username: string,
  notes: readonly Note[],
): Promise<NotesBodySyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const settings = readOfflineDeviceContentSettings();
  if (!settings.contentSyncEnabled) return emptyProgress();

  const eligible = notes.filter((note) =>
    isEligibleForAutoContentSync(note.body?.length ?? 0, settings),
  );

  return {
    ...emptyProgress(),
    total: eligible.length,
    synced: eligible.length,
  };
}
