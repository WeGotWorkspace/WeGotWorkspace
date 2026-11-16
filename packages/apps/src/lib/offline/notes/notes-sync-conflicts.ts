import { createSyncConflictChannel } from "@/lib/offline/core/sync-conflicts";

const channel = createSyncConflictChannel<string>();

export type NotesSyncConflictListener = (noteIds: string[]) => void;

export function setNotesSyncConflictListener(next: NotesSyncConflictListener | undefined): void {
  channel.setListener(next);
}

export function reportNotesSyncConflicts(noteIds: string[]): void {
  channel.report(noteIds);
}
