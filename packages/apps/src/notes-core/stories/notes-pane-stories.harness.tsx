import { useMemo } from "react";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import type { NotesUIData } from "@/lib/models/notes-types";
import { useNotesController } from "@/notes-core/src/use-notes-controller";

export type NotesPaneStoryHarnessOptions = {
  listLoading?: boolean;
  /** Replace `data.notes` while keeping notebooks/tags aligned with bootstrap when possible. */
  notesOverride?: Note[];
  /** Full UI data replacement. */
  data?: NotesUIData;
};

export function useNotesPaneStoryController(options?: NotesPaneStoryHarnessOptions) {
  const bootstrap = useMemo(() => {
    if (options?.data) {
      return createNotesAppBootstrap({ data: options.data });
    }
    const base = createNotesAppBootstrap();
    if (options?.notesOverride !== undefined) {
      return createNotesAppBootstrap({
        data: { ...base.data, notes: options.notesOverride },
      });
    }
    return base;
  }, [options?.data, options?.notesOverride]);

  return useNotesController({
    data: bootstrap.data,
    listLoading: options?.listLoading ?? false,
    operations: undefined,
  });
}
