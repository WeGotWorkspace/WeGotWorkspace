import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { persistHiddenTaskListIds, readTasksViewPrefs } from "@/tasks-core/src/tasks-view-prefs";

/** Device-local hidden-list set. Same localStorage algorithm as Calendar. */
export function useTasksHiddenIds(taskLists: ReadonlyArray<{ id: string; isVisible?: boolean }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(taskLists, {
    read: () => {
      const prefs = readTasksViewPrefs();
      if (!prefs) return null;
      return { hiddenIds: prefs.hiddenTaskListIds, knownIds: prefs.knownTaskListIds };
    },
    write: persistHiddenTaskListIds,
  });
  return { hiddenTaskListIds: hiddenIds, setHiddenTaskListIds: setHiddenIds };
}
