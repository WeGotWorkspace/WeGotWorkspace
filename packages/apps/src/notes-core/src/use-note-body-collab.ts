import { useEffect, useMemo, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import type { Note } from "@/lib/models/note";
import { settleNoteArchivedElsewhere } from "@/lib/offline/notes/notes-archived-elsewhere";
import type { NoteCollabConfig } from "@/note-detail-view/src/note-text-editor-body";
import { buildNoteCollabUrls } from "@/notes-core/src/note-collab-path";
import { createWgwNotesCollabWire } from "@/notes-core/src/notes-collab-wgw-wire";

type UseNoteBodyCollabArgs = {
  active: Note | undefined;
  /** An archived note is read-only (#1535): no room, only the stored body. */
  archived: boolean;
  username: string | undefined;
  displayName: string | undefined;
  /** Account of the offline cache, for the archive-wins notice. */
  offlineUsername: string | null | undefined;
};

/**
 * The open note's body room. The body lives in the Docs Yjs collab document
 * keyed by the note's UID; only against the live API (mock and Storybook use
 * the solo editor).
 */
export function useNoteBodyCollab({
  active,
  archived,
  username,
  displayName,
  offlineUsername,
}: UseNoteBodyCollabArgs) {
  const [noteCollabUrls, setNoteCollabUrls] = useState<NoteCollabConfig["urls"] | undefined>(
    undefined,
  );
  const [accessLost, setAccessLost] = useState(false);
  const activeNoteId = active?.id;
  const activeCreatePending = active?.createPending === true;

  useEffect(() => {
    if (!wgwLiveApiEnabled() || !activeNoteId || archived || !username) {
      setNoteCollabUrls(undefined);
      return;
    }
    // Until its create reaches the server the room is local-only: the body is
    // kept in IndexedDB under the note's final UID, then saved once it exists.
    setAccessLost(false);
    let cancelled = false;
    void buildNoteCollabUrls(activeNoteId, {
      createPending: activeCreatePending,
      onPersistForbidden: () => {
        setAccessLost(true);
        setNoteCollabUrls(undefined);
      },
      onPersistArchived: () => {
        if (offlineUsername) void settleNoteArchivedElsewhere(offlineUsername, activeNoteId);
      },
    })
      .then((urls) => {
        if (!cancelled) setNoteCollabUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setNoteCollabUrls(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCreatePending, activeNoteId, archived, offlineUsername, username]);

  const notesCollabWire = useMemo(() => createWgwNotesCollabWire(), []);
  const noteBodyCollab = useMemo<NoteCollabConfig | undefined>(() => {
    if (!wgwLiveApiEnabled() || !active || !noteCollabUrls || !username) return undefined;
    return {
      userName: displayName || username,
      urls: noteCollabUrls,
      wire: notesCollabWire,
    };
  }, [active, displayName, noteCollabUrls, notesCollabWire, username]);

  return { noteBodyCollab, accessLost };
}
