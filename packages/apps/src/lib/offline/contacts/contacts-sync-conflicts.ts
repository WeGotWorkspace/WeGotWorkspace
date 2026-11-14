import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();

export type ContactsSyncConflictListener = (cardIds: string[]) => void;

export function setContactsSyncConflictListener(
  next: ContactsSyncConflictListener | undefined,
): void {
  channel.setListener(next);
}

export function reportContactsSyncConflicts(cardIds: string[]): void {
  channel.report(cardIds);
}
