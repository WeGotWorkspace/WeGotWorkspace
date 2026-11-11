import { useEffect, useRef } from "react";
import type { TaskList } from "@/lib/models/tasks-types";
import { DEFAULT_TASKS_VIEW } from "@/tasks-core/src/tasks-route-search";

/**
 * When the open list leaves the cache (deleted elsewhere, access removed, a
 * refused offline write), go to the default view instead of showing the list's
 * id as the title. A list id that was never loaded (a link to a list still
 * loading) is left alone.
 */
export function useLeaveRemovedListView(
  view: string,
  taskLists: Pick<TaskList, "id">[],
  selectView: (view: string) => void,
): void {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const list of taskLists) seen.current.add(list.id);
    if (!view.startsWith("list:")) return;
    const listId = view.slice(5);
    if (seen.current.has(listId) && !taskLists.some((list) => list.id === listId)) {
      selectView(DEFAULT_TASKS_VIEW);
    }
  }, [selectView, taskLists, view]);
}
