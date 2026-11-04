import type { RescueTarget } from "@/lib/offline/core/rescue-parked-writes";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { RescueDialog } from "@/rescue-ui/rescue-dialog";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { tasksRescueView } from "@/tasks-core/src/tasks-rescue-view";
import type { TaskList } from "@/tasks-core/src/tasks-types";

export type TasksRescueDialogProps = {
  open: boolean;
  writes: ParkedTask[];
  /** Lists the person can add tasks to. */
  lists: TaskList[];
  busy?: boolean;
  labels: TasksUILabels;
  onMove: (ids: string[], target: RescueTarget) => void;
  onDiscard: (ids: string[]) => void;
  /** Closing without a choice keeps the tasks parked. */
  onLater: () => void;
};

/** The shared rescue dialog (#1825) for tasks, one list at a time. */
export function TasksRescueDialog({ lists, labels, ...props }: TasksRescueDialogProps) {
  return <RescueDialog {...props} containers={lists} view={tasksRescueView(labels)} />;
}
