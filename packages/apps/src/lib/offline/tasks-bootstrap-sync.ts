import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

const topic = cacheChangedTopic(TASKS_DOMAIN);

/**
 * Tell the other tabs that the shared tasks cache changed (inbound pull,
 * reconnect flush, refresh). Both tabs share one changes token, so the tab
 * that did not pull would otherwise see no change and keep a stale list.
 */
export const notifyTasksBootstrapUpdated = topic.notifyOtherTabs;

/** Subscribe to cache updates from other tabs for the same offline account. */
export const subscribeTasksBootstrapUpdated = topic.subscribe;
