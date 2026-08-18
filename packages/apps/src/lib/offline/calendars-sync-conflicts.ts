import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();

export type CalendarsSyncConflictListener = (eventIds: string[]) => void;

export function setCalendarsSyncConflictListener(
  next: CalendarsSyncConflictListener | undefined,
): void {
  channel.setListener(next);
}

export function reportCalendarsSyncConflicts(eventIds: string[]): void {
  channel.report(eventIds);
}
