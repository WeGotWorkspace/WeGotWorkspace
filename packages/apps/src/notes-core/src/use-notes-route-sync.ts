import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  notesNavigateTarget,
  notesNoteFromParams,
  notesViewFromLocation,
  type NotesRouteParams,
} from "@/notes-core/src/notes-route-search";

/** Sync notes workspace view/selection with path-based `/notes/...` routes. */
export function useNotesRouteSync() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false }) as NotesRouteParams;

  const initialView = useMemo(
    () => notesViewFromLocation(location.pathname, params),
    [location.pathname, params],
  );
  const initialNoteId = useMemo(() => notesNoteFromParams(params), [params]);

  const currentViewRef = useRef<string>(initialView);
  const currentNoteRef = useRef<string>(initialNoteId);

  useEffect(() => {
    currentViewRef.current = initialView;
  }, [initialView]);

  useEffect(() => {
    currentNoteRef.current = initialNoteId;
  }, [initialNoteId]);

  const handleViewChange = useCallback(
    (view: string) => {
      currentViewRef.current = view;
      // Keep the open note so follow-the-note (notebook move) lands on
      // `/notes/notebooks/NEW/:noteId`. Sidebar selectView clears activeId
      // first; onNoteChange("") then drops the note from the path.
      const target = notesNavigateTarget(view, currentNoteRef.current);
      void navigate({ ...target, replace: true });
    },
    [navigate],
  );

  const handleNoteChange = useCallback(
    (noteId: string) => {
      currentNoteRef.current = noteId;
      const view = currentViewRef.current;
      const target = notesNavigateTarget(view, noteId);
      // Push when opening a note so Back returns to the list/filter path;
      // replace when clearing the note id (view switches already replace).
      void navigate({ ...target, replace: !noteId });
    },
    [navigate],
  );

  return {
    initialView,
    initialNoteId,
    handleViewChange,
    handleNoteChange,
  };
}
