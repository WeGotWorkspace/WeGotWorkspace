import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { notesHiddenNotebooks } from "@/notes-core/src/notes-view-prefs";

/** Device-local hidden-notebook set. Same localStorage algorithm as Tasks/Calendar. */
export function useNotesHiddenIds(notebooks: ReadonlyArray<{ id: string; isVisible?: boolean }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(notebooks, notesHiddenNotebooks);
  return { hiddenNotebookIds: hiddenIds, setHiddenNotebookIds: setHiddenIds };
}
