import { useCallback, useState } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { useOfflineSyncToast } from "@/lib/offline/use-offline-sync-toast";
import type { NotesApiSource } from "@/notes-core/src/notes-api-source";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { useNotesRouteSync } from "@/notes-core/src/use-notes-route-sync";
import { useNotesAPI } from "@/notes-core/src/use-notes-api";

export type NotesAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: NotesApiSource;
};

export function NotesApp({ apiSource }: NotesAppProps = {}) {
  const { initialView, initialNoteId, handleViewChange, handleNoteChange } = useNotesRouteSync();
  const [syncConflictNoteIds, setSyncConflictNoteIds] = useState<string[]>([]);

  const handleSyncConflict = useCallback((noteIds: string[]) => {
    setSyncConflictNoteIds((prev) => {
      const next = new Set(prev);
      for (const id of noteIds) next.add(id);
      return [...next];
    });
  }, []);

  const clearSyncConflicts = useCallback(() => {
    setSyncConflictNoteIds([]);
  }, []);

  const {
    phase,
    error,
    retry,
    successVersion,
    bootstrapRevision,
    syncing,
    listLoading,
    listRefreshing,
    refreshList,
    data,
    session,
    operations,
  } = useNotesAPI(apiSource, { onSyncConflict: handleSyncConflict });

  useOfflineSyncToast(syncing, defaultNotesLabels.toastSynced);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load live notes"
      successVersion={successVersion}
      render={() => (
        <NotesWorkspace
          data={data}
          session={session}
          operations={operations}
          listLoading={listLoading}
          listRefreshing={listRefreshing}
          bootstrapRevision={bootstrapRevision}
          onRefreshList={refreshList}
          initialView={initialView}
          initialNoteId={initialNoteId}
          onViewChange={handleViewChange}
          onNoteChange={handleNoteChange}
          syncConflictNoteIds={syncConflictNoteIds}
          onClearSyncConflicts={clearSyncConflicts}
          onLogout={() => {
            window.location.assign("/logout");
          }}
        />
      )}
    />
  );
}
