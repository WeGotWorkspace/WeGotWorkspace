import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();

export type TasksSyncConflictListener = (taskIds: string[]) => void;

export function setTasksSyncConflictListener(next: TasksSyncConflictListener | undefined): void {
  channel.setListener(next);
}

export function reportTasksSyncConflicts(taskIds: string[]): void {
  channel.report(taskIds);
}
