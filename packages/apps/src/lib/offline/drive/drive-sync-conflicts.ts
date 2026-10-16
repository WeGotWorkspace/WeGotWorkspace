import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();

export type DriveSyncConflictListener = (apiPaths: string[]) => void;

export function setDriveSyncConflictListener(next: DriveSyncConflictListener | undefined): void {
  channel.setListener(next);
}

export function reportDriveSyncConflicts(apiPaths: string[]): void {
  channel.report(apiPaths);
}
