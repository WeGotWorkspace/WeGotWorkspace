import { ListPlus } from "lucide-react";
import type { RescueLabels, RescueView } from "@/rescue-ui/rescue-adapter";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListIcon } from "@/tasks-core/src/tasks-list-icon";
import type { TaskList } from "@/tasks-core/src/tasks-types";

/** The Tasks words of the shared rescue dialog. */
export function tasksRescueLabels(L: TasksUILabels): RescueLabels {
  return {
    step: L.rescueStep,
    title: L.rescueListTitle,
    reason: L.rescueReason,
    editsAsNew: L.rescueEditsAsNew,
    destinationLabel: L.rescueDestinationLabel,
    newContainer: L.rescueNewList,
    newContainerLabel: L.rescueNewListLabel,
    newContainerName: L.rescueNewListName,
    move: L.rescueMove,
    discard: L.rescueDiscard,
    later: L.rescueLater,
    notice: L.rescueNotice,
    review: L.rescueReview,
    moved: L.rescueMoved,
    discarded: L.rescueDiscarded,
    failed: L.rescueFailed,
    openElsewhere: L.rescueOpenElsewhere,
  };
}

const views = new WeakMap<TasksUILabels, RescueView<TaskList>>();

/** How task lists look in the shared rescue dialog; one object per set of labels. */
export function tasksRescueView(L: TasksUILabels): RescueView<TaskList> {
  let view = views.get(L);
  if (!view) {
    view = {
      labels: tasksRescueLabels(L),
      surfaceClassName: "tasks-dialog-surface",
      containerIcon: (list) => <TaskListIcon list={list} />,
      noticeIcon: <ListPlus aria-hidden />,
    };
    views.set(L, view);
  }
  return view;
}
