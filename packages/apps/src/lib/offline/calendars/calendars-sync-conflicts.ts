import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();
const schedulingChannel = createSyncConflictChannel<string>();

export type CalendarsSyncConflictListener = (eventIds: string[]) => void;
export type CalendarsSchedulingConflictListener = (notificationIds: string[]) => void;

export function setCalendarsSyncConflictListener(
  next: CalendarsSyncConflictListener | undefined,
): void {
  channel.setListener(next);
}

export function reportCalendarsSyncConflicts(eventIds: string[]): void {
  channel.report(eventIds);
}

export function setCalendarsSchedulingConflictListener(
  next: CalendarsSchedulingConflictListener | undefined,
): void {
  schedulingChannel.setListener(next);
}

export function reportCalendarsSchedulingConflicts(notificationIds: string[]): void {
  schedulingChannel.report(notificationIds);
}
