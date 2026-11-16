import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { MEET_CHAT_DOMAIN } from "@/lib/offline/meet-chat/meet-chat-schema";

const topic = cacheChangedTopic(MEET_CHAT_DOMAIN);

/**
 * Tell the other tabs that the shared chat cache changed: a message written
 * here (also offline), a flush, or an inbound pull. Each tab only re-reads
 * the cache when told, so an offline tab never saw a message another tab sent.
 */
export const notifyMeetChatCacheChanged = topic.notifyOtherTabs;

/** Hear another tab's change to the chat cache of the same offline account. */
export const subscribeMeetChatCacheChanged = topic.subscribe;
