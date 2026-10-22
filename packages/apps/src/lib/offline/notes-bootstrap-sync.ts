import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

type NotesBootstrapUpdated = { type: "notes-bootstrap-updated"; username: string };

const topic = crossTabTopic(
  "wgw.notes.bootstrap",
  (value): value is NotesBootstrapUpdated =>
    (value as NotesBootstrapUpdated | null)?.type === "notes-bootstrap-updated",
);

/**
 * Tell the other tabs that the shared notes cache changed (flush, refresh,
 * archive). This tab already shows it, so it is skipped.
 */
export function notifyNotesBootstrapUpdated(username: string): void {
  if (!username) return;
  topic.publish({ type: "notes-bootstrap-updated", username }, { otherTabsOnly: true });
}

/** Subscribe to cache updates from other tabs for the same offline account. */
export function subscribeNotesBootstrapUpdated(username: string, onUpdate: () => void): () => void {
  if (!username) return () => undefined;
  return topic.subscribe((message) => {
    if (message.username === username) onUpdate();
  });
}
