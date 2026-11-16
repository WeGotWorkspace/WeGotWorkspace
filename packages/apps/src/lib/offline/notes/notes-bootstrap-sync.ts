import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";

const topic = cacheChangedTopic(NOTES_DOMAIN);

/**
 * Tell the other tabs that the shared notes cache changed (flush, refresh,
 * archive). This tab already shows it, so it is skipped.
 */
export const notifyNotesBootstrapUpdated = topic.notifyOtherTabs;

/** Subscribe to cache updates from other tabs for the same offline account. */
export const subscribeNotesBootstrapUpdated = topic.subscribe;
