import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";

/** The parked tasks of one list the person lost write access to. */
export type TaskRescueGroup = {
  containerId: string;
  containerName: string;
  reason: ParkedTask["reason"];
  writes: ParkedTask[];
};

/** One group per list, in the order the lists were first refused. */
export function groupParkedTasks(writes: ParkedTask[]): TaskRescueGroup[] {
  const groups = new Map<string, TaskRescueGroup>();
  for (const write of [...writes].sort((a, b) => a.parkedAt - b.parkedAt)) {
    const group = groups.get(write.containerId);
    if (group) group.writes.push(write);
    else
      groups.set(write.containerId, {
        containerId: write.containerId,
        containerName: write.containerName,
        reason: write.reason,
        writes: [write],
      });
  }
  return [...groups.values()];
}
