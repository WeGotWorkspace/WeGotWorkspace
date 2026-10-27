import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

/**
 * The server no longer has a note this device still had changes for (it was
 * deleted elsewhere). The cache and queue drop it; every tab says so, so an
 * offline edit is never lost silently.
 */
export type NoteDropped = { username: string; noteId: string; title: string };

const topic = crossTabTopic(
  "wgw-notes-dropped",
  (value): value is NoteDropped => typeof (value as NoteDropped | null)?.noteId === "string",
);

export const announceNoteDropped = (dropped: NoteDropped): void => topic.publish(dropped);
export const subscribeNoteDropped = topic.subscribe;
