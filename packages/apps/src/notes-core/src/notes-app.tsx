import { useCallback, useMemo, useRef, useState } from "react";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  resolveNotesConflictKeepLocal,
  resolveNotesConflictUseServer,
} from "@/lib/offline/notes-conflict-resolution";
import { resolveNotesOfflineUsername } from "@/lib/offline/offline-session";
import { useOfflineSyncToast } from "@/lib/offline/use-offline-sync-toast";
import type { Note } from "@/lib/models/note";
import type { NotesApiSource } from "@/notes-core/src/notes-api-source";
import { NotesConflictDialog } from "@/notes-core/src/notes-conflict-dialog";
import { noteListTitle } from "@/notes-core/src/notes-note-utils";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { useNotesRouteSync } from "@/notes-core/src/use-notes-route-sync";
import { useNotesAPI } from "@/notes-core/src/use-notes-api";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createWgwDriveShareOperations } from "@/lib/api/wgw/drive-shares";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";

export type NotesAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: NotesApiSource;
};

export function NotesApp({ apiSource }: NotesAppProps = {}) {
  const { initialView, initialNoteId, handleViewChange, handleNoteChange } = useNotesRouteSync();

  const notesRef = useRef<Note[]>([]);
  const [conflictQueue, setConflictQueue] = useState<string[]>([]);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const handleSyncConflict = useCallback((noteIds: string[]) => {
    setConflictQueue((prev) => {
      const next = [...prev];
      for (const id of noteIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, []);

  const {
    phase,
    error,
    retry,
    successVersion,
    bootstrapRevision,
    syncing,
    listLoading,
    refreshList,
    data,
    session,
    operations,
  } = useNotesAPI(apiSource, { onSyncConflict: handleSyncConflict });

  const shareOperations = useMemo(
    () =>
      wgwLiveApiEnabled() ? createWgwDriveShareOperations() : createMockDriveShareOperations(),
    [],
  );

  useOfflineSyncToast(syncing, defaultNotesLabels.toastSynced);

  notesRef.current = data.notes;

  const offlineUsername = resolveNotesOfflineUsername(session.user.username);
  const activeConflictId = conflictQueue[0] ?? null;
  const activeConflictNote = activeConflictId
    ? notesRef.current.find((n) => n.id === activeConflictId)
    : undefined;
  const activeConflictTitle = activeConflictNote
    ? noteListTitle(activeConflictNote)
    : activeConflictId || "";

  const dismissActiveConflict = useCallback(() => {
    setConflictQueue((prev) => prev.slice(1));
  }, []);

  const resolveActiveConflict = useCallback(
    (mode: "local" | "server") => {
      if (!activeConflictId || !offlineUsername) {
        dismissActiveConflict();
        return;
      }
      const noteId = activeConflictId;
      const username = offlineUsername;
      setResolvingConflict(true);
      void (async () => {
        try {
          if (mode === "local") {
            await resolveNotesConflictKeepLocal(username, noteId);
          } else {
            await resolveNotesConflictUseServer(username, noteId);
          }
        } catch {
          // Resolution best-effort; refresh below re-reads the latest state.
        } finally {
          setResolvingConflict(false);
          dismissActiveConflict();
          refreshList();
        }
      })();
    },
    [activeConflictId, offlineUsername, dismissActiveConflict, refreshList],
  );

  return (
    <>
      <WorkspaceLiveAppShell
        phase={phase}
        error={error}
        retry={retry}
        errorTitle="Could not load live notes"
        successVersion={successVersion}
        render={(key) => (
          <NotesWorkspace
            key={key}
            data={data}
            session={session}
            operations={operations}
            shareOperations={shareOperations}
            listLoading={listLoading}
            bootstrapRevision={bootstrapRevision}
            onRefreshList={refreshList}
            initialView={initialView}
            initialNoteId={initialNoteId}
            onViewChange={handleViewChange}
            onNoteChange={handleNoteChange}
            onLogout={() => {
              window.location.assign("/logout");
            }}
          />
        )}
      />
      <NotesConflictDialog
        open={activeConflictId !== null}
        noteTitle={activeConflictTitle}
        remainingCount={Math.max(conflictQueue.length - 1, 0)}
        busy={resolvingConflict}
        labels={defaultNotesLabels}
        onKeepLocal={() => resolveActiveConflict("local")}
        onUseServer={() => resolveActiveConflict("server")}
        onOpenChange={(open) => {
          if (!open && !resolvingConflict) dismissActiveConflict();
        }}
      />
    </>
  );
}
