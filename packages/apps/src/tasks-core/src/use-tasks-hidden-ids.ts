import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { tasksHiddenLists } from "@/tasks-core/src/tasks-view-prefs";

/** Device-local hidden-list set. Same localStorage algorithm as Calendar. */
export function useTasksHiddenIds(taskLists: ReadonlyArray<{ id: string; isVisible?: boolean }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(taskLists, tasksHiddenLists);
  return { hiddenTaskListIds: hiddenIds, setHiddenTaskListIds: setHiddenIds };
}
