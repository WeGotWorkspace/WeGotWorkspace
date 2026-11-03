import { useEffect } from "react";
import type { Note } from "@/lib/models/note";

type UseArchivedNoteFollowsViewArgs = {
  /** The stored copy: cache and server (`data.notes`). */
  serverNotes: readonly Note[];
  activeId: string;
  /** The shown copy, including this tab's unsaved archive. */
  archived: Record<string, boolean>;
  view: string;
  setView: (view: string) => void;
};

/**
 * #1531: an archived note open outside the Archived view moves there and
 * stays open, read-only (#1535). That covers an old link and an archive made
 * in another tab. The stored and the shown copy must both be archived: an
 * archive made in this tab closes the note before it is saved, as before.
 */
export function useArchivedNoteFollowsView({
  serverNotes,
  activeId,
  archived,
  view,
  setView,
}: UseArchivedNoteFollowsViewArgs): void {
  const storedArchived =
    !!activeId && serverNotes.some((note) => note.id === activeId && note.archived === true);
  const follow = storedArchived && archived[activeId] === true && view !== "archive";
  useEffect(() => {
    if (follow) setView("archive");
  }, [follow, setView]);
}
