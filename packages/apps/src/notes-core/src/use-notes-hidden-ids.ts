import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { persistHiddenNotebookIds, readNotesViewPrefs } from "@/notes-core/src/notes-view-prefs";

/** Device-local hidden-notebook set. Same localStorage algorithm as Tasks/Calendar. */
export function useNotesHiddenIds(notebooks: ReadonlyArray<{ id: string; isVisible?: boolean }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(notebooks, {
    read: () => {
      const prefs = readNotesViewPrefs();
      if (!prefs) return null;
      return { hiddenIds: prefs.hiddenNotebookIds, knownIds: prefs.knownNotebookIds };
    },
    write: persistHiddenNotebookIds,
  });
  return { hiddenNotebookIds: hiddenIds, setHiddenNotebookIds: setHiddenIds };
}
