import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

/**
 * A queued note create reached the server. The open Notes UI (this tab and
 * others) drops the note's `createPending` flag, so its body room switches
 * from local-only to the server and the pending body is saved. The id does
 * not change: the app picked it.
 */
export type NoteCreated = { username: string; noteId: string };

const topic = crossTabTopic(
  "wgw-notes-created",
  (value): value is NoteCreated => typeof (value as NoteCreated | null)?.noteId === "string",
);

export const announceNoteCreated = (created: NoteCreated): void => topic.publish(created);
export const subscribeNoteCreated = topic.subscribe;
